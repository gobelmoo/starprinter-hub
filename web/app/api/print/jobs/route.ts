import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { uuidSchema } from '@/lib/validation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  printerId: uuidSchema,
  jobId: z.string().min(1),
  markup: z.string().min(1),
});

export async function POST(req: Request) {
  if (req.headers.get('x-api-key') !== process.env.ZOHO_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { printerId, jobId, markup } = parsed.data;

  const printer = await db.query.printers.findFirst({
    where: and(eq(printers.id, printerId), eq(printers.isActive, true)),
  });
  if (!printer) {
    return Response.json(
      { error: `Printer ${printerId} not found or inactive` },
      { status: 400 },
    );
  }

  const inserted = await db
    .insert(printJobs)
    .values({
      printerId,
      sourceJobId: jobId,
      template: 'markup',
      payload: { markup },
    })
    .onConflictDoNothing()
    .returning({ id: printJobs.id });

  if (inserted.length === 0) {
    return Response.json({ ok: true, status: 'duplicate', jobId });
  }

  return Response.json({
    ok: true,
    status: 'queued',
    id: inserted[0].id,
    jobId,
  });
}
