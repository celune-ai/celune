import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-semibold text-white">403</h1>
      <p className="text-white/60">You don&apos;t have permission to access this page.</p>
      <Link
        href="/tasks"
        className="text-sm text-white/70 underline transition-colors hover:text-white"
      >
        Back to tasks
      </Link>
    </div>
  );
}
