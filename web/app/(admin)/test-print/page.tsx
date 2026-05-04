import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { sendTestPrint } from './actions';

export const dynamic = 'force-dynamic';

const SAMPLE_MARKUP = `[align: centre][mag: w 2; h 2]ใบเสร็จทดสอบ[mag]
[align: left]
[feed: lines 1]
รายการ:
- ผัดไทย         120.00
- ต้มยำ           80.00
[align: right]
TOTAL 200.00
[align: centre]
[feed: lines 2]
ขอบคุณค่ะ
[feed: lines 3]
[cut]`;

export default async function TestPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; printerId?: string }>;
}) {
  const { error, printerId: preselectedId } = await searchParams;

  const activePrinters = await db
    .select({
      id: printers.id,
      name: printers.name,
      macAddress: printers.macAddress,
      branchCode: printers.branchCode,
    })
    .from(printers)
    .where(and(eq(printers.isActive, true)))
    .orderBy(asc(printers.name));

  if (activePrinters.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Test print</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          No active printers. Add one in{' '}
          <Link href="/printers" className="underline">
            Printers
          </Link>{' '}
          first.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Test print</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inject a Star Markup print job directly into the queue. Bypasses
          Zoho.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        action={sendTestPrint}
        className="space-y-5 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Printer" required>
            <select
              name="printerId"
              required
              defaultValue={preselectedId ?? ''}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              <option value="" disabled>
                -- choose printer --
              </option>
              {activePrinters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.macAddress})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Job ID"
            hint="Leave blank to auto-generate (TEST-<timestamp>)"
          >
            <input
              type="text"
              name="jobId"
              placeholder="TEST-001"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </Field>
        </div>

        <Field
          label="Star Markup"
          required
          hint="Tags: align, mag/magnify, bold, underline, image, barcode, qrcode, column, font, feed, cut. Include [cut] yourself."
        >
          <textarea
            name="markup"
            required
            rows={16}
            defaultValue={SAMPLE_MARKUP}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Send to printer
          </button>
          <Link
            href="/"
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
