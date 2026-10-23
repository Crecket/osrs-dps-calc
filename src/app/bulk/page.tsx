'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// the bulk tool moved to the homepage; keep old links working
const Page = () => {
  const router = useRouter();
  useEffect(() => router.replace('/'), [router]);
  return null;
};

export default Page;
