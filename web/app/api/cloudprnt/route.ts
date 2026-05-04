import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { renderMarkup } from '@/lib/cputil';
import { and, asc, eq, inArray } from 'drizzle-orm';

export const runtime = 'nodejs';

async function findPrinterByMac(mac: string) {
  return db.query.printers.findFirst({
    where: eq(printers.macAddress, mac),
  });
}

async function ackJob(mac: string, code: string | null) {
  const printer = await findPrinterByMac(mac);
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

  return new Response(null, { status: 204 });
}

// POST — printer poll
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Some printers send empty/non-JSON during initial handshake
  }

  const mac = String(body.printerMAC ?? '').toLowerCase();
  if (!mac) return Response.json({ jobReady: false });

  const printer = await findPrinterByMac(mac);
  if (!printer || !printer.isActive) {
    return Response.json({ jobReady: false });
  }

  // Update last-seen + status. Per spec, every poll carries statusCode.
  await db
    .update(printers)
    .set({
      lastSeenAt: new Date(),
      lastStatusCode: body.statusCode
        ? decodeURIComponent(String(body.statusCode))
        : null,
    })
    .where(eq(printers.id, printer.id));

  // Peek at any in-flight job (pending = waiting; printing = stuck from prior cycle).
  // No state mutation here — claim happens in GET.
  const job = await db.query.printJobs.findFirst({
    where: and(
      eq(printJobs.printerId, printer.id),
      inArray(printJobs.status, ['pending', 'printing']),
    ),
    orderBy: asc(printJobs.createdAt),
  });

  return Response.json({
    jobReady: !!job,
    mediaTypes: job ? ['application/vnd.star.starprntcore'] : undefined,
    jobToken: job?.id,
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

  const printer = await findPrinterByMac(mac);
  if (!printer) return new Response('not found', { status: 404 });

  // 1) Idempotent: if already-printing job exists for this printer, return it.
  let job = await db.query.printJobs.findFirst({
    where: and(
      eq(printJobs.printerId, printer.id),
      eq(printJobs.status, 'printing'),
    ),
    orderBy: asc(printJobs.createdAt),
  });

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
    return new Response(null, { status: 500 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await renderMarkup(markup);
  } catch (err) {
    await db
      .update(printJobs)
      .set({
        status: 'failed',
        errorMessage: `cputil error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(eq(printJobs.id, job.id));
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
