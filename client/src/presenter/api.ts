import { useEffect, useState } from 'react';
import { storage, store } from '../common/net.ts';

const TOKEN_KEY = 'mb.presenterToken';

export const getToken = () => storage<string>(TOKEN_KEY, '');
export const setToken = (t: string) => store(TOKEN_KEY, t || null);

export class AuthError extends Error {}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-presenter-token': getToken() },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401) throw new AuthError('Login required');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-presenter-token': getToken() }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url as string;
}

export function download(filename: string, content: string | Uint8Array, type = 'application/json') {
  const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const routeParts = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

export function useHashRoute(): string[] {
  const [parts, setParts] = useState(routeParts);
  useEffect(() => {
    const on = () => setParts(routeParts());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export const go = (path: string) => {
  location.hash = path;
};
