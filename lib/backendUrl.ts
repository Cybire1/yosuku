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

  const url = sourceUrl ? new URL(sourceUrl) : null;
  const hostname = url?.hostname || 'localhost';
  const protocol = url?.protocol || (LOCAL_HOSTS.has(hostname) ? 'http:' : 'https:');
  return `${protocol}//${hostname}:3001`;
}
