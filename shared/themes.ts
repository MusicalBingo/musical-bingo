// Holiday looks for the big screen and the phones. The colours live in client/src/common/themes.css (one block per id);
// this file has what the apps need to know: the name, the title emoji, and the falling / rising decorations.
// The answer colours and shapes never change with the theme, so "the purple square" always means the same thing.

export type ThemeId = 'classic' | 'christmas' | 'newyear' | 'valentine' | 'stpatrick' | 'easter' | 'halloween' | 'summer';

export interface ThemeDecor {
  /** fall from the top, rise from the bottom, or twinkle in place */
  mode: 'fall' | 'rise' | 'twinkle';
  /** characters to scatter; plain symbols take a colour from `colors`, emoji keep their own */
  glyphs: string[];
  colors?: string[];
  /** smallest and largest size, in vh on the big screen */
  size: [number, number];
}

export interface Theme {
  id: ThemeId;
  name: string;
  /** shown next to the quiz title and in pickers */
  emoji: string;
  /** browser bar colour on phones */
  barColor: string;
  decor: ThemeDecor | null;
}

export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic', emoji: '🎵', barColor: '#140f2e', decor: null },
  {
    id: 'christmas',
    name: 'Christmas',
    emoji: '🎄',
    barColor: '#0a2418',
    decor: { mode: 'fall', glyphs: ['❄', '❅', '❆', '•'], colors: ['#ffffff', '#e6f2ff', '#cfe6ff'], size: [1.8, 4.4] },
  },
  {
    id: 'newyear',
    name: 'New Year',
    emoji: '🥂',
    barColor: '#060a1c',
    decor: { mode: 'fall', glyphs: ['■', '●', '▲', '✦', '▬'], colors: ['#f2d27a', '#e8e8f0', '#ff5fa2', '#5fd3ff', '#b58cff'], size: [1.6, 3.2] },
  },
  {
    id: 'valentine',
    name: "Valentine's Day",
    emoji: '💘',
    barColor: '#22081a',
    decor: { mode: 'rise', glyphs: ['❤', '♥', '❤'], colors: ['#ff4f81', '#ff8fb1', '#e0306f', '#ffc2d4'], size: [2, 4.6] },
  },
  {
    id: 'stpatrick',
    name: "St Patrick's Day",
    emoji: '🍀',
    barColor: '#05231a',
    decor: { mode: 'fall', glyphs: ['☘', '☘', '✦'], colors: ['#4cd964', '#2fbf71', '#9be37b', '#ffd34d'], size: [2, 4.6] },
  },
  {
    id: 'easter',
    name: 'Easter',
    emoji: '🐰',
    barColor: '#1e1940',
    decor: { mode: 'fall', glyphs: ['🌷', '🐣', '🥚', '🌼', '🌸'], size: [2.4, 4.2] },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    emoji: '🎃',
    barColor: '#100a12',
    decor: { mode: 'rise', glyphs: ['🦇', '👻', '🎃', '🦇', '🕸'], size: [2.4, 4.8] },
  },
  {
    id: 'summer',
    name: 'Summer party',
    emoji: '☀️',
    barColor: '#04232e',
    decor: { mode: 'twinkle', glyphs: ['🌴', '🍹', '🍉', '☀️', '🏖', '🌺'], size: [2.8, 4.8] },
  },
];

export const themeById = (id: string | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Accepts an id or a name typed in a spreadsheet ("Christmas", "new year", "St. Patrick's"). */
export function parseTheme(v: unknown): ThemeId {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const t = THEMES.find((x) => x.id === s || x.name.toLowerCase().replace(/[^a-z]/g, '') === s || (s.length >= 4 && x.name.toLowerCase().replace(/[^a-z]/g, '').startsWith(s)));
  if (t) return t.id;
  if (/xmas|noel|navidad|weihnacht/.test(s)) return 'christmas';
  if (/nye|newyear|silvest/.test(s)) return 'newyear';
  if (/patrick|paddy|irish/.test(s)) return 'stpatrick';
  if (/valent|love/.test(s)) return 'valentine';
  return 'classic';
}
