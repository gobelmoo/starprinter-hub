'use server';

import { db } from '@/lib/db';
import { printJobs } from '@/lib/db/schema';
import { invalidatePrinterJobs } from '@/lib/cache/printer';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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

  invalidatePrinterJobs();
  revalidatePath(`/jobs/${id}`);
  revalidatePath('/');
}

export async function markJobDone(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // delete-on-success ใช้กับ manual path ด้วย เพื่อไม่ให้เกิด row 'done' ค้าง
  // (retention cron กวาดเฉพาะ 'failed') — ปุ่มนี้คือ "เคลียร์งานนี้ออกจากคิว"
  await db.delete(printJobs).where(eq(printJobs.id, id));

  invalidatePrinterJobs();
  revalidatePath('/');
  redirect('/');
}
