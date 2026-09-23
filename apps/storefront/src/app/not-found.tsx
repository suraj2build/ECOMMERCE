import Link from 'next/link';
import { buttonClassName } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-gutter text-center">
      <h1 className="font-display text-2xl text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link href="/" className={buttonClassName('primary')}>
        Back to Home
      </Link>
    </div>
  );
}
