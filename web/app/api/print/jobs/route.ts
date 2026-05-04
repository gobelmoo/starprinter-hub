import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { uuidSchema } from '@/lib/validation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  printerId: uuidSchema,
  referenceId: z.string().min(1).optional(),
  markup: z.string().min(1),
});

export async function POST(req: Request) {
  if (req.headers.get('x-api-key') !== process.env.PRINT_API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { printerId, referenceId, markup } = parsed.data;

  const printer = await db.query.printers.findFirst({
    where: and(eq(printers.id, printerId), eq(printers.isActive, true)),
  });
  if (!printer) {
    return Response.json(
      { error: `Printer ${printerId} not found or inactive` },
      { status: 400 },
    );
  }

  const [job] = await db
    .insert(printJobs)
    .values({
      printerId,
      referenceId: referenceId ?? null,
      payload: { markup },
    })
    .returning({ id: printJobs.id });

  return Response.json({
    ok: true,
    jobId: job.id,
    referenceId: referenceId ?? null,
  });
}
