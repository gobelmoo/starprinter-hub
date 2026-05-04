import Link from 'next/link';
import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PrinterForm } from '@/components/printer-form';
import { formatTime } from '@/lib/format';
import { uuidSchema } from '@/lib/validation';
import { updatePrinter } from '../../actions';

export default async function EditPrinterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();

  const printer = await db.query.printers.findFirst({
    where: eq(printers.id, id),
  });
  if (!printer) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/printers"
        className="inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        ← Printers
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Edit printer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Last seen {formatTime(printer.lastSeenAt)} • Last status:{' '}
            {printer.lastStatusCode ?? '-'}
          </p>
        </div>
        {printer.isActive && (
          <Link
            href={`/test-print?printerId=${printer.id}`}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Send test print →
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <PrinterForm
          action={updatePrinter}
          defaultValues={{
            id: printer.id,
            name: printer.name,
            macAddress: printer.macAddress,
            branchCode: printer.branchCode,
            isActive: printer.isActive,
          }}
          error={error}
          submitLabel="Save changes"
        />
      </div>
    </div>
  );
}
