// Printable 75-ball bingo cards.
// Cards are generated from (series, number) with a seeded random generator, so the
// server can re-create any card from its ID and check it against the drawn numbers
// without storing anything.

export const FREE = 0;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSeries(series: string): string {
  return series.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'A';
}

export function cardId(series: string, n: number): string {
  return `${normalizeSeries(series)}-${String(n).padStart(3, '0')}`;
}

export function parseCardId(id: string): { series: string; n: number } | null {
  const m = id.trim().toUpperCase().match(/^([A-Z0-9]{1,8})\s*[-\s]\s*(\d{1,5})$/);
  if (!m) return null;
  return { series: m[1], n: Number(m[2]) };
}

/** Returns a 5x5 grid as rows; grid[row][col]. The centre is FREE (0). */
export function makeCard(series: string, n: number): number[][] {
  const rand = mulberry32(hashString(`${normalizeSeries(series)}#${n}`));
  const cols: number[][] = [];
  for (let c = 0; c < 5; c++) {
    const pool = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    cols.push(pool.slice(0, 5).sort((a, b) => a - b));
  }
  cols[2][2] = FREE;
  return Array.from({ length: 5 }, (_, r) => cols.map((col) => col[r]));
}

export interface CardCheck {
  id: string;
  grid: number[][];
  marked: boolean[][];
  lines: string[];
  fullHouse: boolean;
  missing: number;
}

export function checkCard(series: string, n: number, drawn: number[]): CardCheck {
  const grid = makeCard(series, n);
  const set = new Set(drawn);
  const marked = grid.map((row) => row.map((v) => v === FREE || set.has(v)));
  const lines: string[] = [];
  for (let r = 0; r < 5; r++) if (marked[r].every(Boolean)) lines.push(`Row ${r + 1}`);
  for (let c = 0; c < 5; c++) if (marked.every((row) => row[c])) lines.push(`Column ${'BINGO'[c]}`);
  if ([0, 1, 2, 3, 4].every((i) => marked[i][i])) lines.push('Diagonal ↘');
  if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i])) lines.push('Diagonal ↙');
  const missing = marked.flat().filter((m) => !m).length;
  return { id: cardId(series, n), grid, marked, lines, fullHouse: missing === 0, missing };
}
