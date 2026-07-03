// /beta graduated: the founder-validated 6-24 trading surface was promoted to the
// main market flow at /markets-live (cadence tier bar + the same proven machinery).
// Anyone holding the old beta link lands on the real thing.
import { redirect } from 'next/navigation';

export default function BetaRedirect() {
  redirect('/markets-live');
}
