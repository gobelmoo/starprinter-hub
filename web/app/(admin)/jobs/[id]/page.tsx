import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { formatTime } from '@/lib/format';
import { uuidSchema } from '@/lib/validation';
import { markJobDone, retryJob } from './actions';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const job = await db.query.printJobs.findFirst({
    where: eq(printJobs.id, id),
  });
  if (!job) notFound();

  const printer = await db.query.printers.findFirst({
    where: eq(printers.id, job.printerId),
  });

  const markup =
    typeof (job.payload as { markup?: unknown } | null)?.markup === 'string'
      ? (job.payload as { markup: string }).markup
      : null;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        ← Back to dashboard
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold">
            {job.sourceJobId}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
            <StatusBadge status={job.status} />
            <span>Created {formatTime(job.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {(job.status === 'failed' || job.status === 'printing') && (
            <form action={retryJob}>
              <input type="hidden" name="id" value={job.id} />
              <button
                type="submit"
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Retry
              </button>
            </form>
          )}
          {job.status !== 'done' && (
            <form action={markJobDone}>
              <input type="hidden" name="id" value={job.id} />
              <button
                type="submit"
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Mark done
              </button>
            </form>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-gray-200 bg-white p-5 text-sm">
        <div>
          <dt className="text-xs uppercase text-gray-500">Printer</dt>
          <dd className="mt-1">{printer?.name ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Branch</dt>
          <dd className="mt-1">{printer?.branchCode ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Template</dt>
          <dd className="mt-1 font-mono text-xs">{job.template}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Printed at</dt>
          <dd className="mt-1">{formatTime(job.printedAt)}</dd>
        </div>
        {job.errorMessage && (
          <div className="col-span-2">
            <dt className="text-xs uppercase text-red-700">Error</dt>
            <dd className="mt-1 text-red-700">{job.errorMessage}</dd>
          </div>
        )}
      </dl>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Star Markup
        </h2>
        <pre className="overflow-x-auto whitespace-pre rounded-lg border border-gray-200 bg-white p-4 font-mono text-xs leading-5">
          {markup ?? '[markup missing in payload]'}
        </pre>
      </section>
    </div>
  );
}
