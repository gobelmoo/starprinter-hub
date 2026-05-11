'use server';

import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { count, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { MAX_PRINTERS } from '@/lib/constants';
import { THERMAL_WIDTHS } from '@/lib/printer-config';
import { errorRedirect, isUniqueViolation } from '@/lib/server-actions';
import { uuidSchema } from '@/lib/validation';

const PrinterInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  macAddress: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/,
      'MAC must look like 00:11:62:00:00:01',
    ),
  branchCode: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  paperWidth: z.enum(THERMAL_WIDTHS),
  isActive: z.boolean(),
});

function parseForm(fd: FormData) {
  return PrinterInputSchema.safeParse({
    name: fd.get('name'),
    macAddress: fd.get('macAddress'),
    branchCode: fd.get('branchCode'),
    paperWidth: fd.get('paperWidth'),
    isActive: fd.get('isActive') === 'on',
  });
}

function parseId(fd: FormData, fallbackPath: string): string {
  const result = uuidSchema.safeParse(fd.get('id'));
  if (!result.success) errorRedirect(fallbackPath, 'Invalid printer id');
  return result.data;
}

export async function createPrinter(fd: FormData) {
  const parsed = parseForm(fd);
  if (!parsed.success) {
    errorRedirect('/printers/new', parsed.error.issues[0].message);
  }

  const [{ value }] = await db.select({ value: count() }).from(printers);
  if (value >= MAX_PRINTERS) {
    errorRedirect(
      '/printers/new',
      `Limit reached (max ${MAX_PRINTERS} printers). Delete or deactivate one first.`,
    );
  }

  try {
    await db.insert(printers).values(parsed.data);
  } catch (err) {
    const msg = isUniqueViolation(err)
      ? `MAC ${parsed.data.macAddress} is already registered`
      : err instanceof Error
        ? err.message
        : 'Insert failed';
    errorRedirect('/printers/new', msg);
  }

  redirect('/printers');
}

export async function updatePrinter(fd: FormData) {
  const id = parseId(fd, '/printers');
  const parsed = parseForm(fd);
  if (!parsed.success) {
    errorRedirect(`/printers/${id}/edit`, parsed.error.issues[0].message);
  }

  try {
    await db.update(printers).set(parsed.data).where(eq(printers.id, id));
  } catch (err) {
    const msg = isUniqueViolation(err)
      ? `MAC ${parsed.data.macAddress} is already registered on another printer`
      : err instanceof Error
        ? err.message
        : 'Update failed';
    errorRedirect(`/printers/${id}/edit`, msg);
  }

  redirect('/printers');
}

export async function deletePrinter(fd: FormData) {
  const id = parseId(fd, '/printers');

  // FK on print_jobs blocks delete if any history exists. Pre-check so we
  // can surface a clear "set inactive instead" message rather than letting
  // the FK violation bubble up as a generic 500.
  const [{ value }] = await db
    .select({ value: count() })
    .from(printJobs)
    .where(eq(printJobs.printerId, id));

  if (value > 0) {
    errorRedirect(
      '/printers',
      `Printer has ${value} job(s) in history. Set inactive instead of delete.`,
    );
  }

  await db.delete(printers).where(eq(printers.id, id));
  redirect('/printers');
}
