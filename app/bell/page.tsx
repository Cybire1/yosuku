import { redirect } from 'next/navigation';

// The Bell ritual was folded into the core /markets flow. Keep the route as a
// redirect so any lingering inbound links resolve cleanly instead of 404ing.
export default function BellRedirect() {
  redirect('/markets');
}
