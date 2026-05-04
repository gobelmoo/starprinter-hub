import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { sendTestPrint } from './actions';

export const dynamic = 'force-dynamic';

const SAMPLE_MARKUP = `[align: centre][font: a]\\
[image: url https://star-emea.com/wp-content/uploads/2015/01/logo.jpg;
        width 60%;
        min-width 48mm]\\
[magnify: width 2; height 1]
This is a Star Markup Document!
ข้อความภาษาไทย
[magnify: width 3; height 2]Columns[magnify]
[align: left]\\
[column: left: Item 1;      right: $10.00]
[column: left: Item 2;      right: $9.95]
[column: left: Item 3;      right: $103.50]

[align: centre]\\
[barcode: type code39;
          data 123456789012;
          height 15mm;
          module 0;
          hri]
[align]\\
Thank you for trying the new Star Document Markup Language\\
we hope you will find it useful. Please let us know!
[cut: feed; partial]`;

const PROD_URL = 'https://starprinter-hub.vercel.app';

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

function ApiSpec({ printerId }: { printerId: string }) {
  const sampleBody = JSON.stringify(
    {
      printerId,
      referenceId: 'ORD-20260505-001',
      markup: '[align: centre]Hello\n[cut]',
    },
    null,
    2,
  );

  const curl = [
    `curl -X POST '${PROD_URL}/api/print/jobs' \\`,
    `  -H 'x-api-key: <your-api-key>' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${sampleBody.replace(/\n/g, '\n      ')}'`,
  ].join('\n');

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        API spec
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        วิธีเรียกจากระบบภายนอก (Zoho, Make, n8n, ฯลฯ) — แทน{' '}
        <code className="rounded bg-gray-100 px-1">{'<your-api-key>'}</code> ด้วย
        secret ที่ WidelyNext แจ้ง
      </p>

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium text-gray-700">Endpoint</dt>
        <dd className="font-mono text-xs">
          POST {PROD_URL}/api/print/jobs
        </dd>

        <dt className="font-medium text-gray-700">Headers</dt>
        <dd className="font-mono text-xs">
          x-api-key: {'<your-api-key>'}
          <br />
          Content-Type: application/json
        </dd>

        <dt className="self-start pt-1 font-medium text-gray-700">Body</dt>
        <dd>
          <pre className="overflow-x-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5">
{sampleBody}
          </pre>
          <ul className="mt-2 space-y-1 text-xs text-gray-500">
            <li>
              <code className="rounded bg-gray-100 px-1">printerId</code>{' '}
              <span className="text-red-500">required</span> — UUID จากตาราง
              printer ในระบบ
            </li>
            <li>
              <code className="rounded bg-gray-100 px-1">referenceId</code>{' '}
              optional — รหัสอ้างอิงฝั่งคุณ ส่งซ้ำได้ (ไม่ dedup)
            </li>
            <li>
              <code className="rounded bg-gray-100 px-1">markup</code>{' '}
              <span className="text-red-500">required</span> — Star Document
              Markup
            </li>
          </ul>
        </dd>

        <dt className="self-start pt-1 font-medium text-gray-700">Response</dt>
        <dd>
          <pre className="overflow-x-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5">
{`{
  "ok": true,
  "jobId": "<uuid generated by server>",
  "referenceId": "ORD-20260505-001"
}`}
          </pre>
        </dd>

        <dt className="self-start pt-1 font-medium text-gray-700">cURL</dt>
        <dd>
          <pre className="overflow-x-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5">
{curl}
          </pre>
        </dd>
      </dl>

      <p className="mt-4 text-xs text-gray-500">
        เอกสารฉบับเต็ม: ดู{' '}
        <code className="rounded bg-gray-100 px-1">_documents/API.md</code>
      </p>
    </section>
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
