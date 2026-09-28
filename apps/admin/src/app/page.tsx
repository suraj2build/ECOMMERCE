'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredSession } from '@/lib/staff-auth';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getStoredSession() ? '/dashboard' : '/login');
  }, [router]);
  return null;
}
