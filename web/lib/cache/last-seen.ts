import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';

// Must be STRICTLY > Neon Free auto-suspend (5 min) so the compute can sleep
// in the gap between writes. isOnline() in lib/format.ts uses 12 min so the
// UI doesn't flicker offline when a write was just skipped.
const DEBOUNCE_MS = 10 * 60 * 1000;

// Per warm-instance Map — not shared across instances/cold starts. Real write
// rate is O(instances × cold_starts × printers), not O(printers). Acceptable
// given printer count is small and the dominant DB cost is already eliminated
// by the hot-path cache.
const lastWriteAt = new Map<string, number>();

export async function maybeUpdateLastSeen(
  printerId: string,
  statusCode: string | null,
): Promise<void> {
  const now = Date.now();
  const prev = lastWriteAt.get(printerId) ?? 0;
  if (now - prev < DEBOUNCE_MS) return;

  await db
    .update(printers)
    .set({
      lastSeenAt: new Date(now),
      lastStatusCode: statusCode,
    })
    .where(eq(printers.id, printerId));

  // Only mark as written AFTER the DB write succeeds. If the UPDATE throws,
  // the next poll retries instead of silently extending the debounce window.
  lastWriteAt.set(printerId, now);
}
