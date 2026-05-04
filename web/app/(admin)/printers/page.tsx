import Link from 'next/link';
import { db } from '@/lib/db';
import { printers } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { timeAgo } from '@/lib/format';
import { MAX_PRINTERS } from '@/lib/constants';
import { OnlinePill } from '@/components/online-pill';
import { deletePrinter } from './actions';

export const dynamic = 'force-dynamic';

export default async function PrintersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const list = await db.select().from(printers).orderBy(asc(printers.name));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Printers</h1>
          <p className="mt-1 text-sm text-gray-500">
            {list.length} of {MAX_PRINTERS} max — active printers are matched
            against{' '}
            <code className="rounded bg-gray-100 px-1">branchCode</code> from
            Zoho.
          </p>
        </div>
        <Link
          href="/printers/new"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          + Add printer
        </Link>
      </div>

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Branch</th>
              <th className="px-4 py-2 text-left">MAC</th>
              <th className="px-4 py-2 text-left">Active</th>
              <th className="px-4 py-2 text-left">Last seen</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No printers yet. Click <strong>Add printer</strong> to get
                  started.
                </td>
              </tr>
            ) : (
              list.map((p) => (
                <tr key={p.id}>
                  <td
                    className="px-4 py-3 font-mono text-xs text-gray-500"
                    title={p.id}
                  >
                    {p.id.slice(0, 8)}
                  </td>
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
                      inactiveLabel="idle"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {timeAgo(p.lastSeenAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/printers/${p.id}/edit`}
                        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Edit
                      </Link>
                      <form action={deletePrinter}>
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          type="submit"
                          className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
