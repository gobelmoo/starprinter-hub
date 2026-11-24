import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { invalidatePrinterJobs } from '@/lib/cache/printer';
import { warmImages } from '@/lib/print-images';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';

type Result =
  | { ok: true; id: string }
  | { ok: false; reason: 'printer-not-found' };

export async function enqueueMarkupJob(input: {
  printerId: string;
  referenceId: string | null;
  markup: string;
}): Promise<Result> {
  const printer = await db.query.printers.findFirst({
    where: and(
      eq(printers.id, input.printerId),
      eq(printers.isActive, true),
    ),
  });
  if (!printer) return { ok: false, reason: 'printer-not-found' };

  const [job] = await db
    .insert(printJobs)
    .values({
      printerId: printer.id,
      referenceId: input.referenceId,
      payload: { markup: input.markup },
    })
    .returning({ id: printJobs.id });

  invalidatePrinterJobs();
  // Download remote images after the response is sent, so the printer's
  // first GET finds them cached instead of waiting on a slow origin.
  after(() => warmImages(input.markup));
  return { ok: true, id: job.id };
}
