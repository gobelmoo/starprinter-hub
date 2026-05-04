const styles: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  printing: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const labels: Record<string, string> = {
  pending: 'pending',
  printing: 'printing',
  done: 'done',
  failed: 'failed',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
