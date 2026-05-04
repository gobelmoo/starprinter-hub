'use server';

import { db } from '@/lib/db';
import { printJobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function retryJob(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db
    .update(printJobs)
    .set({
      status: 'pending',
      errorMessage: null,
      printedAt: null,
    })
    .where(eq(printJobs.id, id));

  revalidatePath(`/jobs/${id}`);
  revalidatePath('/');
}

export async function markJobDone(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await db
    .update(printJobs)
    .set({
      status: 'done',
      errorMessage: null,
      printedAt: new Date(),
    })
    .where(eq(printJobs.id, id));

  revalidatePath(`/jobs/${id}`);
  revalidatePath('/');
}
