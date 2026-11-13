import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestionImage, QuestionMedia } from '../../../shared/types.ts';
import { parseYouTube } from '../../../shared/util.ts';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}

interface PlayerProps {
  media: QuestionMedia;
  /** change this to (re)start the clip from its start point */
  playKey: string | number | null;
  stopped?: boolean;
  /** show the YouTube video (otherwise it plays hidden, audio only) */
  showVideo?: boolean;
  volume?: number;
  onPlayingChange?: (playing: boolean) => void;
}

/** Plays a question's clip: a section of a YouTube video or of an audio file. */
export function ClipPlayer({ media, playKey, stopped, showVideo, volume = 100, onPlayingChange }: PlayerProps) {
  const yt = media.source === 'youtube' ? parseYouTube(media.url) : null;
  if (media.source === 'youtube' && yt)
    return <YouTubeClip videoId={yt.id} media={media} playKey={playKey} stopped={stopped} showVideo={showVideo} volume={volume} onPlayingChange={onPlayingChange} />;
  if (media.source === 'audio' && media.url)
    return <AudioClip media={media} playKey={playKey} stopped={stopped} volume={volume} onPlayingChange={onPlayingChange} />;
  return null;
}

function YouTubeClip({ videoId, media, playKey, stopped, showVideo, volume, onPlayingChange }: PlayerProps & { videoId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const ready = useRef<Promise<any> | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);
  const cbRef = useRef(onPlayingChange);
  cbRef.current = onPlayingChange;

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement('div');
    host.current!.appendChild(el);
    ready.current = loadYouTubeApi().then(
      (YT) =>
        new Promise((resolve) => {
          if (cancelled) return;
          player.current = new YT.Player(el, {
            width: '100%',
            height: '100%',
            playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
            events: {
              onReady: () => resolve(player.current),
              onStateChange: (e: any) => cbRef.current?.(e.data === YT.PlayerState.PLAYING),
            },
          });
        }),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(stopTimer.current);
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
      cbRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (playKey == null) return;
    let alive = true;
    ready.current?.then((p) => {
      if (!alive || !p) return;
      window.clearTimeout(stopTimer.current);
      p.loadVideoById({ videoId, startSeconds: media.start, endSeconds: media.start + media.duration });
      // safety stop (ads or seeking can make endSeconds unreliable)
      stopTimer.current = window.setTimeout(() => p.pauseVideo?.(), (media.duration + 15) * 1000);
    });
    return () => {
      alive = false;
    };
  }, [playKey, videoId, media.start, media.duration]);

  useEffect(() => {
    if (stopped) ready.current?.then((p) => p?.pauseVideo?.());
  }, [stopped]);

  useEffect(() => {
    ready.current?.then((p) => p?.setVolume?.(volume));
  }, [volume]);

  return <div ref={host} className={showVideo ? 'yt-visible' : 'yt-hidden'} />;
}

function AudioClip({ media, playKey, stopped, volume = 100, onPlayingChange }: PlayerProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const stopTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const a = ref.current;
    if (!a || playKey == null) return;
    window.clearTimeout(stopTimer.current);
    const start = () => {
      a.currentTime = media.start;
      a.play().catch(() => onPlayingChange?.(false));
      stopTimer.current = window.setTimeout(() => a.pause(), media.duration * 1000);
    };
    if (a.readyState >= 1) start();
    else a.addEventListener('loadedmetadata', start, { once: true });
    return () => {
      a.removeEventListener('loadedmetadata', start);
      window.clearTimeout(stopTimer.current);
    };
  }, [playKey, media.url, media.start, media.duration]);

  useEffect(() => {
    if (stopped) ref.current?.pause();
  }, [stopped]);

  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  useEffect(() => () => ref.current?.pause(), []);

  return (
    <audio
      ref={ref}
      src={media.url}
      preload="auto"
      onPlay={() => onPlayingChange?.(true)}
      onPause={() => onPlayingChange?.(false)}
      onEnded={() => onPlayingChange?.(false)}
    />
  );
}

function seededOrder(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A picture that is uncovered bit by bit as `progress` goes from 0 to 1. */
export function ImageReveal({ image, progress, full, seed }: { image: QuestionImage; progress: number; full: boolean; seed: string }) {
  const g = image.grid;
  const order = useMemo(() => seededOrder(seed, g * g), [seed, g]);
  const [loaded, setLoaded] = useState(false);
  const p = full ? 1 : Math.max(0, Math.min(1, progress));

  let overlay = null;
  let imgStyle: React.CSSProperties = {};
  if (image.reveal === 'tiles') {
    const shown = full ? g * g : Math.max(1, Math.ceil(p * g * g));
    const visible = new Set(order.slice(0, shown));
    overlay = (
      <div className="tiles" style={{ gridTemplateColumns: `repeat(${g}, 1fr)`, gridTemplateRows: `repeat(${g}, 1fr)` }}>
        {Array.from({ length: g * g }, (_, i) => (
          <div key={i} className={`tile ${visible.has(i) ? 'open' : ''}`}>
            <span>?</span>
          </div>
        ))}
      </div>
    );
  } else if (image.reveal === 'blur') {
    imgStyle = { filter: `blur(${Math.round((1 - p) * 40)}px)`, transform: `scale(${1 + (1 - p) * 0.1})` };
  }

  return (
    <div className="image-reveal">
      <img src={image.url} alt="" style={imgStyle} onLoad={() => setLoaded(true)} />
      {loaded && overlay}
    </div>
  );
}
