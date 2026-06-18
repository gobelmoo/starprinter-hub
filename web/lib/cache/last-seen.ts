import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';

// Per warm-instance: the heartbeat generation we last wrote for each printer.
// getPendingState() returns a `gen` that flips once per HEARTBEAT_SEC (cadence
// is global because the Data Cache entry is shared across instances). When an
// instance sees a new gen, it writes last_seen ONCE — synchronously in the
// poll handler (NOT inside unstable_cache, whose background revalidation may
// drop the write) — so the write rides the same compute wake as the read.
const lastGen = new Map<string, number>();

export async function recordHeartbeat(
  printerId: string,
  statusCode: string | null,
  gen: number,
): Promise<void> {
  if (lastGen.get(printerId) === gen) return;

  await db
    .update(printers)
    .set({ lastSeenAt: new Date(), lastStatusCode: statusCode })
    .where(eq(printers.id, printerId));

  // Mark only AFTER the write succeeds — a thrown UPDATE retries next poll
  // instead of silently skipping this heartbeat.
  lastGen.set(printerId, gen);
}
