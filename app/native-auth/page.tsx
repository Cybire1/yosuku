'use client';

// Native auth bridge for the mobile app's Google zkLogin.
//
// Google "Web application" OAuth clients only allow https redirect URIs, not custom app
// schemes. So the mobile app runs the implicit OAuth flow with THIS page as the redirect,
// using the same web client id as the site (keeping the zkLogin `aud` identical, so the
// mobile address matches the web address). Google lands here with the id_token in the URL
// fragment; we hand it straight back to the app via its custom scheme (thebell://auth).
// Web-app users never see this page.
import { useEffect, useState } from 'react';

const APP_SCHEME = 'thebell://auth';

export default function NativeAuth() {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    // Implicit flow returns the token in the fragment; fall back to the query string.
    const frag = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = frag || window.location.search.replace(/^\?/, '');
    const target = `${APP_SCHEME}#${params}`;
    setHref(target);
    window.location.replace(target); // auto-forward into the app
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#050505',
        color: '#FAFAFA',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ opacity: 0.7, letterSpacing: '0.02em' }}>Signing you in…</p>
        {href && (
          <p style={{ marginTop: 16 }}>
            <a href={href} style={{ color: '#E04D26', textDecoration: 'none', fontWeight: 600 }}>
              Return to Yosuku →
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
