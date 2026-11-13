import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import type { PresenterExtra, PublicState, PlayerYou } from '../../../shared/types.ts';

export interface StateMsg {
  state: PublicState;
  you?: PlayerYou | null;
  extra?: PresenterExtra;
}

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}

/** Emits an event and resolves with the server's acknowledgement. */
export function emit<T = any>(event: string, payload?: unknown, timeoutMs = 8000): Promise<T> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(timeoutMs).emit(event, payload, (err: unknown, res: T) => {
      if (err) resolve({ ok: false, error: 'No connection to the server. Retrying…' } as T);
      else resolve(res);
    });
  });
}

// ---------- clock sync, so countdowns match the server ----------

let offset = 0;
export const serverNow = () => Date.now() + offset;

async function syncClock() {
  const s = getSocket();
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const t = await new Promise<number | null>((res) => s.timeout(3000).emit('time', null, (e: unknown, v: number) => res(e ? null : v)));
    const t1 = Date.now();
    if (t == null) continue;
    if (t1 - t0 < best) {
      best = t1 - t0;
      offset = t + (t1 - t0) / 2 - t1;
    }
  }
}

export function useConnection(onConnect?: () => void) {
  const [connected, setConnected] = useState(getSocket().connected);
  const cb = useRef(onConnect);
  cb.current = onConnect;
  useEffect(() => {
    const s = getSocket();
    const up = () => {
      setConnected(true);
      void syncClock();
      cb.current?.();
    };
    const down = () => setConnected(false);
    s.on('connect', up);
    s.on('disconnect', down);
    if (s.connected) up();
    return () => {
      s.off('connect', up);
      s.off('disconnect', down);
    };
  }, []);
  return connected;
}

export function useGameState() {
  const [msg, setMsg] = useState<StateMsg | null>(null);
  useEffect(() => {
    const s = getSocket();
    const on = (m: StateMsg) => setMsg(m);
    s.on('state', on);
    return () => {
      s.off('state', on);
    };
  }, []);
  return [msg, setMsg] as const;
}

/** Re-renders every `ms` while `active`, for countdowns and reveal animations. */
export function useTicker(active: boolean, ms = 200) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

/** URL players should open (used for the QR code and shown on screen). */
export async function joinBaseUrl(): Promise<string> {
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    if (info.publicUrl) return info.publicUrl;
    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocal && info.lanAddresses?.length) {
      return `${location.protocol}//${info.lanAddresses[0]}${location.port ? `:${location.port}` : ''}`;
    }
  } catch {
    /* fall through */
  }
  return location.origin;
}

export function qrUrl(text: string) {
  return `/api/qr?text=${encodeURIComponent(text)}`;
}

export function storage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
