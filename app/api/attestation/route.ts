import { NextResponse } from 'next/server';

// Server-side proxy to the live Nautilus enclave that operates the margin desk.
// The site is HTTPS; the enclave is HTTP, so the browser can't fetch it directly
// (mixed content) — we fetch it here on the server and verify the live attestation
// matches the reproducible build measurement.
const ENCLAVE_URL = process.env.ENCLAVE_URL || 'http://100.54.126.119:3001';

// PCRs from the reproducible EIF build (yolev-keeper). Anyone can rebuild the
// open-source enclave and reproduce these, then check the live doc below matches.
const EXPECTED_PCR0 =
  '0c0cfdccd1b6f0cd8d61f43aeb4a19ebd29a4744d45cf65f7c1f7fcb495ff242e3c6e7f306c25da884882c087b3dd20a';
const EXPECTED_PCR2 =
  '21b9efbc184807662e966d34f390821309eeac6802309798826296bf3e8bec7c10edb30948c90ba67310f7b964fc500a';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const r = await fetch(`${ENCLAVE_URL}/get_attestation`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const hex: string = (j.attestation || '').toLowerCase();

    // best-effort module id: text after the "module_id" cbor key (6d6f64756c655f6964)
    let moduleId = '';
    const mi = hex.indexOf('6d6f64756c655f6964');
    if (mi >= 0) {
      const after = hex.slice(mi + 18 + 4); // skip key + short text header
      const ascii = Buffer.from(after.slice(0, 80), 'hex').toString('utf8');
      const m = ascii.match(/i-[0-9a-z-]+enc[0-9a-f]+/);
      if (m) moduleId = m[0];
    }

    const pcr0Matches = hex.includes(EXPECTED_PCR0);
    const pcr2Matches = hex.includes(EXPECTED_PCR2);
    return NextResponse.json({
      live: true,
      verified: pcr0Matches && pcr2Matches,
      pcr0: EXPECTED_PCR0,
      pcr2: EXPECTED_PCR2,
      pcr0Matches,
      pcr2Matches,
      moduleId,
      docBytes: Math.floor(hex.length / 2),
      enclaveUrl: `${ENCLAVE_URL}/get_attestation`,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    return NextResponse.json({
      live: false,
      verified: false,
      pcr0: EXPECTED_PCR0,
      pcr2: EXPECTED_PCR2,
      enclaveUrl: `${ENCLAVE_URL}/get_attestation`,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
