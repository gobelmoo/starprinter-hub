import Link from 'next/link';
import { PrinterForm } from '@/components/printer-form';
import { createPrinter } from '../actions';

export default async function NewPrinterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="space-y-6">
      <Link
        href="/printers"
        className="inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        ← Printers
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Add printer</h1>
        <p className="mt-1 text-sm text-gray-500">
          MAC address ดูจาก self-test ของเครื่องพิมพ์ (กดปุ่ม Feed ค้างตอนเปิดเครื่อง)
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <PrinterForm
          action={createPrinter}
          error={error}
          submitLabel="Create printer"
        />
      </div>
    </div>
  );
}
