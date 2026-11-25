// Keeps the phone screen on while the player page is open, so a phone lying on the table doesn't lock between questions.
//
// 1. The browser's Screen Wake Lock (HTTPS pages, e.g. the cloud server). Phones drop it whenever the page is hidden
//    (screen locked, another app opened), so it is taken again as soon as the page is visible.
// 2. Otherwise a tiny silent video playing in a loop, which phones treat as "watching something" (the trick and the video
//    come from nosleep.js). Used on plain http (the venue laptop on Wi-Fi), older phones, and browsers that refuse the
//    Wake Lock (some in-app browsers). Browsers only start a video after a tap, so every tap retries.
import media from 'nosleep.js/src/media.js';

const hasWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
let wanted = false;
let wakeLockRefused = false;
let sentinel: WakeLockSentinel | null = null;
let requesting = false;
let video: HTMLVideoElement | null = null;

function makeVideo() {
  const v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.setAttribute('title', 'Keeping the screen on');
  for (const [type, src] of [['webm', media.webm], ['mp4', media.mp4]]) {
    const s = document.createElement('source');
    s.src = src;
    s.type = `video/${type}`;
    v.appendChild(s);
  }
  v.addEventListener('loadedmetadata', () => {
    if (v.duration <= 1) v.loop = true; // the webm clip loops by itself
    else v.addEventListener('timeupdate', () => v.currentTime > 0.5 && (v.currentTime = Math.random())); // keep the mp4 clip from ending
  });
  return v;
}

async function acquire() {
  if (!wanted || document.visibilityState !== 'visible') return;
  if (hasWakeLock && !wakeLockRefused) {
    if (requesting || (sentinel && !sentinel.released)) return;
    requesting = true;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch (e: any) {
      // NotAllowedError: this browser won't give it (or not now, e.g. battery saver) -> use the video instead
      if (e?.name === 'NotAllowedError') wakeLockRefused = true;
    } finally {
      requesting = false;
    }
    if (!wanted) return release();
    if (!wakeLockRefused) return;
  }
  video ||= makeVideo();
  if (video.paused) video.play().catch(() => {}); // needs a tap first; tried again on the next one
}

function release() {
  sentinel?.release().catch(() => {});
  sentinel = null;
  video?.pause();
}

/** Turn keeping the screen on on or off. */
export function setKeepAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else release();
}

/** Whether the screen is being kept on right now (for checking from the browser console). */
export function keepAwakeStatus(): 'wake-lock' | 'video' | 'off' {
  if (sentinel && !sentinel.released) return 'wake-lock';
  if (video && !video.paused) return 'video';
  return 'off';
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void acquire());
  for (const ev of ['click', 'touchend', 'keydown']) document.addEventListener(ev, () => void acquire(), { capture: true, passive: true });
}
