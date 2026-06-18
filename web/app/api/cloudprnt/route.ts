import { db } from '@/lib/db';
import { printJobs } from '@/lib/db/schema';
import { renderMarkup } from '@/lib/cputil';
import type { ThermalWidth } from '@/lib/printer-config';
import {
  getPrinterByMacCached,
  getPendingState,
  invalidatePrinterJobs,
} from '@/lib/cache/printer';
import { recordHeartbeat } from '@/lib/cache/last-seen';
import { and, asc, eq, inArray } from 'drizzle-orm';

export const runtime = 'nodejs';

const STUCK_AFTER_MS = 10 * 60 * 1000;

async function ackJob(mac: string, code: string | null) {
  const printer = await getPrinterByMacCached(mac);
  if (!printer) return new Response('not found', { status: 404 });

  // Code 520 = network timeout — leave job 'printing', let printer retry GET
  if (code === '520') return new Response(null, { status: 204 });

  const success = code?.startsWith('2') ?? false;

  await db
    .update(printJobs)
    .set({
      status: success ? 'done' : 'failed',
      errorMessage: success ? null : `printer code: ${code ?? 'unknown'}`,
      printedAt: success ? new Date() : null,
    })
    .where(
      and(
        eq(printJobs.printerId, printer.id),
        eq(printJobs.status, 'printing'),
      ),
    );

  invalidatePrinterJobs();
  return new Response(null, { status: 204 });
}

// POST — printer poll. Hot path: hits Postgres only when (a) cache cold or
// gen flips (~1×/HEARTBEAT_SEC for last_seen write), or (b) a job is waiting.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Some printers send empty/non-JSON during initial handshake
  }

  const mac = String(body.printerMAC ?? '').toLowerCase();
  if (!mac) return Response.json({ jobReady: false });

  const printer = await getPrinterByMacCached(mac);
  if (!printer || !printer.isActive) {
    return Response.json({ jobReady: false });
  }

  // Single heartbeat: pending read (cached, ~1×/HEARTBEAT) + aligned
  // last_seen write in the same compute wake.
  const { pending, gen } = await getPendingState(printer.id);
  await recordHeartbeat(
    printer.id,
    body.statusCode ? decodeURIComponent(String(body.statusCode)) : null,
    gen,
  );

  // Usually false → skip Postgres entirely, compute stays asleep.
  if (!pending) {
    return Response.json({ jobReady: false });
  }

  // Cache says there's a job — confirm + return jobToken. Cache may be stale
  // after ack/expiry; if no row, refresh cache so future polls short-circuit.
  const job = await db.query.printJobs.findFirst({
    where: and(
      eq(printJobs.printerId, printer.id),
      inArray(printJobs.status, ['pending', 'printing']),
    ),
    orderBy: asc(printJobs.createdAt),
    columns: { id: true },
  });

  if (!job) {
    invalidatePrinterJobs();
    return Response.json({ jobReady: false });
  }

  return Response.json({
    jobReady: true,
    mediaTypes: ['application/vnd.star.starprntcore'],
    jobToken: job.id,
  });
}

// GET — printer fetches job content (idempotent)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mac = url.searchParams.get('mac')?.toLowerCase();
  if (!mac) return new Response('mac required', { status: 400 });

  // delete-via-GET fallback (deleteMethod: "GET")
  if (url.searchParams.has('delete')) {
    return ackJob(mac, url.searchParams.get('code'));
  }

  const printer = await getPrinterByMacCached(mac);
  if (!printer) return new Response('not found', { status: 404 });

  // 1) Idempotent: if already-printing job exists for this printer, return it.
  let job = await db.query.printJobs.findFirst({
    where: and(
      eq(printJobs.printerId, printer.id),
      eq(printJobs.status, 'printing'),
    ),
    orderBy: asc(printJobs.createdAt),
  });

  // Self-heal: if the existing 'printing' job has been stuck > 10 min, the
  // printer never sent DELETE (network drop, power cycle). Mark it failed
  // and fall through to claim the next pending. Replaces the per-10-min cron
  // we can't run on Hobby. NOTE: uses createdAt as a proxy for claim time —
  // long-queued jobs that JUST got claimed will be expired on the next poll;
  // operator retry recovers them.
  if (job && Date.now() - job.createdAt.getTime() > STUCK_AFTER_MS) {
    await db
      .update(printJobs)
      .set({
        status: 'failed',
        errorMessage: 'expired (no DELETE received within 10 minutes)',
      })
      .where(eq(printJobs.id, job.id));
    invalidatePrinterJobs();
    job = undefined;
  }

  // 2) Otherwise claim next pending (pending → printing).
  if (!job) {
    const pending = await db.query.printJobs.findFirst({
      where: and(
        eq(printJobs.printerId, printer.id),
        eq(printJobs.status, 'pending'),
      ),
      orderBy: asc(printJobs.createdAt),
    });

    if (pending) {
      const [claimed] = await db
        .update(printJobs)
        .set({ status: 'printing' })
        .where(
          and(eq(printJobs.id, pending.id), eq(printJobs.status, 'pending')),
        )
        .returning();

      job = claimed ?? pending;
    }
  }

  if (!job) return new Response(null, { status: 200 });

  const markup = (job.payload as { markup?: unknown } | null)?.markup;
  if (typeof markup !== 'string') {
    await db
      .update(printJobs)
      .set({
        status: 'failed',
        errorMessage: 'payload.markup missing or not a string',
      })
      .where(eq(printJobs.id, job.id));
    invalidatePrinterJobs();
    return new Response(null, { status: 500 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await renderMarkup(markup, printer.paperWidth as ThermalWidth);
  } catch (err) {
    await db
      .update(printJobs)
      .set({
        status: 'failed',
        errorMessage: `cputil error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(eq(printJobs.id, job.id));
    invalidatePrinterJobs();
    return new Response(null, { status: 500 });
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.star.starprntcore',
      'Content-Length': String(bytes.byteLength),
    },
  });
}

// DELETE — printer ack
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const mac = url.searchParams.get('mac')?.toLowerCase();
  if (!mac) return new Response('mac required', { status: 400 });
  return ackJob(mac, url.searchParams.get('code'));
}
