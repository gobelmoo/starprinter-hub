'use server';

import { redirect } from 'next/navigation';
import { errorRedirect } from '@/lib/server-actions';
import { uuidSchema } from '@/lib/validation';
import { enqueueMarkupJob } from '@/lib/queue/enqueue';

export async function sendTestPrint(fd: FormData) {
  const printerIdResult = uuidSchema.safeParse(fd.get('printerId'));
  if (!printerIdResult.success) {
    errorRedirect('/test-print', 'Pick a printer');
  }

  const markup = String(fd.get('markup') ?? '').trim();
  if (!markup) {
    errorRedirect('/test-print', 'Markup is empty');
  }

  const referenceId = String(fd.get('referenceId') ?? '').trim() || null;

  const result = await enqueueMarkupJob({
    printerId: printerIdResult.data,
    referenceId,
    markup,
  });
  if (!result.ok) {
    errorRedirect('/test-print', 'Printer not found or inactive');
  }

  redirect(`/jobs/${result.id}`);
}
