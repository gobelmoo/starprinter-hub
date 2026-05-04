import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { sendTestPrint } from './actions';
import { ApiSpec } from './api-spec';

export const dynamic = 'force-dynamic';

// String.raw so the trailing `\` (Star Markup soft newline) reads literally
// instead of being a JS escape that needs `\\` doubling.
const SAMPLE_MARKUP = String.raw`[align: centre][font: a]\
[image: url https://star-emea.com/wp-content/uploads/2015/01/logo.jpg;
        width 60%;
        min-width 48mm]\
[magnify: width 2; height 1]
This is a Star Markup Document!
ข้อความภาษาไทย
[magnify: width 3; height 2]Columns[magnify]
[align: left]\
[column: left: Item 1;      right: $10.00]
[column: left: Item 2;      right: $9.95]
[column: left: Item 3;      right: $103.50]

[align: centre]\
[barcode: type code39;
          data 123456789012;
          height 15mm;
          module 0;
          hri]
[align]\
Thank you for trying the new Star Document Markup Language\
we hope you will find it useful. Please let us know!
[cut: feed; partial]`;

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

  const samplePrinterId = preselectedId ?? activePrinters[0].id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Test print</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inject a Star Markup print job directly into the queue. Bypasses any
          external integration.
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
            label="Reference ID"
            hint="Optional — your own reference (order number, ticket id, ฯลฯ). Can repeat."
          >
            <input
              type="text"
              name="referenceId"
              placeholder="ORD-20260505-001"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </Field>
        </div>

        <Field
          label="Star Markup"
          required
          hint="Tags supported: align, mag/magnify, bold, underline, image, barcode, qrcode, column, font, feed, cut. Include [cut] yourself."
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

      <ApiSpec printerId={samplePrinterId} />
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
