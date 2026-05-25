import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';

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

// 5-min TTL acts as a safety net; enqueue/claim/ack call invalidatePrinterJobs()
// for immediate freshness. When false, polls skip Postgres entirely so the
// Neon compute can auto-suspend.
const fetchHasPendingJob = unstable_cache(
  async (printerId: string): Promise<boolean> => {
    const job = await db.query.printJobs.findFirst({
      where: and(
        eq(printJobs.printerId, printerId),
        inArray(printJobs.status, ['pending', 'printing']),
      ),
      orderBy: asc(printJobs.createdAt),
      columns: { id: true },
    });
    return !!job;
  },
  ['has-pending-job'],
  { tags: [PRINT_JOBS_TAG], revalidate: 300 },
);

export function hasPendingJobCached(printerId: string) {
  return fetchHasPendingJob(printerId);
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
