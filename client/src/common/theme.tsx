// Applies the game's holiday theme to the page (big screen and phones) and draws its decorations.
import { useEffect, useMemo, type CSSProperties } from 'react';
import { themeById } from '../../../shared/themes.ts';
import './themes.css';

/** Puts the theme's colours on the page and colours the phone's browser bar to match. */
export function useTheme(id: string | undefined) {
  const theme = themeById(id);
  useEffect(() => {
    const root = document.documentElement;
    if (theme.id === 'classic') delete root.dataset.theme;
    else root.dataset.theme = theme.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.barColor);
  }, [theme.id]);
  return theme;
}

/** Same numbers on every render, so the decorations don't jump when the game state changes. */
function rand(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Snow, confetti, hearts… behind the page. `count` is lower on phones; `unit` is vh on the big screen. */
export function ThemeDecor({ id, count = 24, faint = false }: { id: string | undefined; count?: number; faint?: boolean }) {
  const theme = themeById(id);
  const d = theme.decor;
  const items = useMemo(() => {
    if (!d) return [];
    return Array.from({ length: count }, (_, i) => {
      const glyph = d.glyphs[i % d.glyphs.length];
      const size = d.size[0] + rand(i, 1) * (d.size[1] - d.size[0]);
      const dur = d.mode === 'twinkle' ? 5 + rand(i, 2) * 6 : 11 + rand(i, 2) * 12 - size; // small ones drift a bit slower
      const style = {
        '--x': `${(i / count) * 100 + rand(i, 3) * (100 / count)}%`,
        '--y': `${4 + rand(i, 4) * 88}%`,
        '--s': `${size}vh`,
        '--d': `${dur}s`,
        '--delay': `${-rand(i, 5) * dur}s`, // already spread over the screen when the page opens
        '--sway': `${(rand(i, 6) - 0.5) * 24}vw`,
        '--spin': `${(rand(i, 7) - 0.5) * 720}deg`,
        '--o': `${(faint ? 0.35 : 0.55) + rand(i, 8) * 0.35}`,
        '--c': d.colors ? d.colors[i % d.colors.length] : undefined,
      } as CSSProperties;
      return { glyph, style };
    });
  }, [theme.id, count, faint]);
  if (!d) return null;
  return (
    <div className={`decor ${d.mode}`} aria-hidden="true">
      {items.map((it, i) => (
        <i key={i} style={it.style}>
          {it.glyph}
        </i>
      ))}
    </div>
  );
}
