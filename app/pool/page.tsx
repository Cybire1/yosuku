import { redirect } from 'next/navigation';

// The PLP liquidity page is now the default "Earn yield" tab on /earn.
// Keep this route working (old links, docs) by redirecting to the consolidated hub.
export default function PoolPage() {
  redirect('/earn');
}
