const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getResolverApiBase(): string {
  return '/api/resolver';
}

export function getResolverBackendUrl(sourceUrl?: string): string {
  const configured = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  if (configured) {
    return trimSlash(configured);
  }

  // :3001 was the old box's socat bridge to the enclave. Guessing it in production meant
  // every resolver call went to https://yosuku.xyz:3001, which has never served anything, and
  // spent a 5 second timeout before returning 502. Guess it only where it could plausibly be
  // true, which is a local dev machine, and say so plainly otherwise.
  const url = sourceUrl ? new URL(sourceUrl) : null;
  const hostname = url?.hostname || 'localhost';
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error('BACKEND_URL is not configured.');
  }
  return `http://${hostname}:3001`;
}
