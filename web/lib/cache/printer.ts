import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { HEARTBEAT_SEC } from '@/lib/constants';

// Two coarse tags. Edits to ANY printer invalidate all printer caches,
// and any job state change invalidates all hasJob caches. Cheap and
// matches Drizzle's coarse query patterns.
const PRINTER_TAG = 'printers';
const PRINT_JOBS_TAG = 'print-jobs';

export type CachedPrinter = {
  id: string;
  macAddress: string;
  isActive: boolean;
  paperWidth: string;
};

// 1-hour TTL: printer config rarely changes; admin edits revalidateTag explicitly.
const fetchPrinterByMac = unstable_cache(
  async (mac: string): Promise<CachedPrinter | null> => {
    const p = await db.query.printers.findFirst({
      where: eq(printers.macAddress, mac),
      columns: {
        id: true,
        macAddress: true,
        isActive: true,
        paperWidth: true,
      },
    });
    return p ?? null;
  },
  ['printer-by-mac'],
  { tags: [PRINTER_TAG], revalidate: 3600 },
);

export function getPrinterByMacCached(mac: string) {
  return fetchPrinterByMac(mac);
}

export type PendingState = { pending: boolean; gen: number };

// Single idle Postgres touch per heartbeat. Returns whether a job is waiting
// PLUS a generation stamp that flips on every (re)compute. The poll handler
// uses `gen` to decide when to write last_seen, so the read and the write
// land in the SAME compute wake. enqueue/claim/ack call invalidatePrinterJobs
// ({ expire: 0 }) so a real job busts this immediately — the long revalidate
// is only a missed-invalidation safety net (job delayed at most HEARTBEAT_SEC
// in that rare case).
const fetchPendingState = unstable_cache(
  async (printerId: string): Promise<PendingState> => {
    const job = await db.query.printJobs.findFirst({
      where: and(
        eq(printJobs.printerId, printerId),
        inArray(printJobs.status, ['pending', 'printing']),
      ),
      orderBy: asc(printJobs.createdAt),
      columns: { id: true },
    });
    return { pending: !!job, gen: Date.now() };
  },
  ['pending-state'],
  { tags: [PRINT_JOBS_TAG], revalidate: HEARTBEAT_SEC },
);

export function getPendingState(printerId: string) {
  return fetchPendingState(printerId);
}

// `{ expire: 0 }` flips the call from SWR to immediate invalidation:
// pathWasRevalidated fires so the client router cache busts on Server Action
// redirects, and unstable_cache reads see the fresh value on the very next
// request instead of one cycle later. Works in both Server Actions and Route
// Handlers (unlike updateTag, which throws in /api routes).
export function invalidatePrinters() {
  revalidateTag(PRINTER_TAG, { expire: 0 });
}

export function invalidatePrinterJobs() {
  revalidateTag(PRINT_JOBS_TAG, { expire: 0 });
}
