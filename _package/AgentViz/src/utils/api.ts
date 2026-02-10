const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!apiOrigin) return path;
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}
