import { enqueueMarkupJob } from '@/lib/queue/enqueue';
import { uuidSchema } from '@/lib/validation';
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

  const result = await enqueueMarkupJob({
    printerId,
    referenceId: referenceId ?? null,
    markup,
  });
  if (!result.ok) {
    return Response.json(
      { error: `Printer ${printerId} not found or inactive` },
      { status: 400 },
    );
  }

  return Response.json({
    ok: true,
    jobId: result.id,
    referenceId: referenceId ?? null,
  });
}
