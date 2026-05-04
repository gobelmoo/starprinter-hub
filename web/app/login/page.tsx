import { loginAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        action={loginAction}
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter the admin password to continue.
          </p>
        </div>

        {error && (
          <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            Wrong password.
          </div>
        )}

        <input
          type="password"
          name="password"
          required
          autoFocus
          placeholder="Password"
          className="w-full rounded border border-gray-300 px-3 py-2 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />

        <button
          type="submit"
          className="w-full rounded bg-gray-900 px-3 py-2 text-white hover:bg-black"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
