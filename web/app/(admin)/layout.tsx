import Link from 'next/link';
import { logoutAction } from '../login/actions';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              Star Printer Hub
            </Link>
            <nav className="flex items-center gap-4 text-sm text-gray-600">
              <Link href="/" className="hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/printers" className="hover:text-gray-900">
                Printers
              </Link>
              <Link href="/test-print" className="hover:text-gray-900">
                Test print
              </Link>
            </nav>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
