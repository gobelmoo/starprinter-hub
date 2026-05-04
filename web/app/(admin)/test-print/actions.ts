'use server';

import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { errorRedirect } from '@/lib/server-actions';
import { uuidSchema } from '@/lib/validation';

export async function sendTestPrint(fd: FormData) {
  const printerIdResult = uuidSchema.safeParse(fd.get('printerId'));
  if (!printerIdResult.success) {
    errorRedirect('/test-print', 'Pick a printer');
  }
  const printerId = printerIdResult.data;

  const printer = await db.query.printers.findFirst({
    where: and(eq(printers.id, printerId), eq(printers.isActive, true)),
  });
  if (!printer) {
    errorRedirect('/test-print', 'Printer not found or inactive');
  }

  const markup = String(fd.get('markup') ?? '').trim();
  if (!markup) {
    errorRedirect('/test-print', 'Markup is empty');
  }

  const referenceId = String(fd.get('referenceId') ?? '').trim() || null;

  const [job] = await db
    .insert(printJobs)
    .values({
      printerId: printer.id,
      referenceId,
      payload: { markup },
    })
    .returning({ id: printJobs.id });

  redirect(`/jobs/${job.id}`);
}
