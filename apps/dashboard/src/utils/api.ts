// In dev mode (Vite dev server), always use relative paths — the Vite proxy
// forwards /api to the backend.  VITE_API_ORIGIN is only used in production
// builds (e.g. VS Code webview loading static files from a different origin).
const apiOrigin = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!apiOrigin) return path;
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}
