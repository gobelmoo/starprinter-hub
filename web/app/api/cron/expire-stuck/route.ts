import { db } from '@/lib/db';
import { printJobs } from '@/lib/db/schema';
import { invalidatePrinterJobs } from '@/lib/cache/printer';
import { and, eq, lt } from 'drizzle-orm';

export const runtime = 'nodejs';

const RETENTION_DAYS = 15;

// Stuck-job expiry is handled inline in app/api/cloudprnt/route.ts (GET) so
// Hobby's once-per-day cron limit doesn't leave jobs wedged for ~24h. This
// cron is now retention-only.
export async function GET(req: Request) {
  if (
    req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Retention-only: ไม่มี row 'done' อีกแล้ว (delete-on-success) → กวาดเฉพาะ
  // 'failed' เก่า. ห้ามแตะ 'pending' — printer offline 15+ วันต้องกู้คิวได้.
  const retentionCutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const deleted = await db
    .delete(printJobs)
    .where(
      and(
        eq(printJobs.status, 'failed'),
        lt(printJobs.createdAt, retentionCutoff),
      ),
    )
    .returning({ id: printJobs.id });

  return Response.json({ deleted: deleted.length });
}
