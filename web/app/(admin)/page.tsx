import Link from 'next/link';
import { db } from '@/lib/db';
import { printers, printJobs } from '@/lib/db/schema';
import { asc, desc, eq } from 'drizzle-orm';
import { StatusBadge } from '@/components/status-badge';
import { OnlinePill } from '@/components/online-pill';
import { formatTime, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [printerList, jobList] = await Promise.all([
    db.select().from(printers).orderBy(asc(printers.name)),
    db
      .select({
        id: printJobs.id,
        sourceJobId: printJobs.sourceJobId,
        status: printJobs.status,
        createdAt: printJobs.createdAt,
        printerName: printers.name,
        branchCode: printers.branchCode,
      })
      .from(printJobs)
      .leftJoin(printers, eq(printJobs.printerId, printers.id))
      .orderBy(desc(printJobs.createdAt))
      .limit(50),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Printers
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Branch</th>
                <th className="px-4 py-2 text-left">MAC</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {printerList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No printers registered. Add one via{' '}
                    <code className="rounded bg-gray-100 px-1">
                      pnpm db:studio
                    </code>
                    .
                  </td>
                </tr>
              ) : (
                printerList.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.branchCode ?? '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {p.macAddress}
                    </td>
                    <td className="px-4 py-3">
                      <OnlinePill
                        isActive={p.isActive}
                        lastSeenAt={p.lastSeenAt}
                      />
                      {p.lastStatusCode && (
                        <span className="ml-2 text-xs text-gray-500">
                          {p.lastStatusCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {timeAgo(p.lastSeenAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Recent Jobs (last 50)
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">Order</th>
                <th className="px-4 py-2 text-left">Branch</th>
                <th className="px-4 py-2 text-left">Printer</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No jobs yet.
                  </td>
                </tr>
              ) : (
                jobList.map((j) => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">
                      {formatTime(j.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {j.sourceJobId}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {j.branchCode ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {j.printerName ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/jobs/${j.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        view
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
