import { db } from '@/lib/db';
import { printJobs } from '@/lib/db/schema';
import { and, eq, lt } from 'drizzle-orm';

export const runtime = 'nodejs';

// Vercel Cron attaches `Authorization: Bearer ${CRON_SECRET}` automatically.
export async function GET(req: Request) {
  if (
    req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Any job stuck 'printing' for >10 min (no DELETE arrived) → fail it.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);

  const expired = await db
    .update(printJobs)
    .set({
      status: 'failed',
      errorMessage: 'expired (no DELETE received within 10 minutes)',
    })
    .where(
      and(eq(printJobs.status, 'printing'), lt(printJobs.createdAt, cutoff)),
    )
    .returning({ id: printJobs.id });

  return Response.json({ expired: expired.length });
}
