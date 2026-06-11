'use client';

import { useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { registerEnokiWallets } from '@mysten/enoki';

/**
 * Registers Enoki zkLogin wallets ("Sign in with Google") into dapp-kit's wallet
 * list. Renders nothing; runs once the SuiClient is available. Gracefully no-ops
 * if the env config is missing, so the app works with or without zkLogin.
 *
 *   NEXT_PUBLIC_ENOKI_API_KEY      enoki_public_… (client-safe by design)
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID   the Google OAuth web client id (…apps.googleusercontent.com)
 */
export default function RegisterEnoki() {
  const client = useSuiClient();

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!apiKey || !googleClientId) return;

    // Pin the redirect to the bare origin so it's identical on every page and
    // matches the whitelisted Google redirect URI (Enoki otherwise defaults to
    // the full current URL → trailing slash → redirect_uri_mismatch).
    const { unregister } = registerEnokiWallets({
      apiKey,
      providers: { google: { clientId: googleClientId, redirectUrl: window.location.origin } },
      client,
      network: 'testnet',
    });
    return unregister;
  }, [client]);

  return null;
}
