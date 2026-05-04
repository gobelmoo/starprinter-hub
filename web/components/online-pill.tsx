import { isOnline } from '@/lib/format';

type Props = {
  isActive: boolean;
  lastSeenAt: Date | string | null;
  inactiveLabel?: string;
};

export function OnlinePill({
  isActive,
  lastSeenAt,
  inactiveLabel = 'offline',
}: Props) {
  if (!isActive) {
    return <span className="text-xs text-gray-400">disabled</span>;
  }

  const online = isOnline(lastSeenAt);
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        online ? 'text-green-700' : 'text-gray-400'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          online ? 'bg-green-500' : 'bg-gray-300'
        }`}
      />
      {online ? 'online' : inactiveLabel}
    </span>
  );
}
