// /markets-live — RETIRED. The flagship browser at /markets is the one market flow now.
//
// This is left as a redirect rather than deleted because the route was linked from the word
// market, from /beta, and from anywhere people bookmarked it. Deleting it would turn those into
// 404s; forwarding costs nothing and keeps old links working.
import { redirect } from 'next/navigation';

export default function MarketsLiveRedirect() {
  redirect('/markets');
}
