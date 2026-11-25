// Quiz <-> Excel workbook. One row per question on the "Questions" sheet, quiz options on "Settings".
import { ANSWER_STYLES, DEFAULT_SETTINGS, type Question, type QuestionKind, type Quiz, type QuizSettings } from './types.ts';
import { parseYouTube } from './util.ts';
import { THEMES, parseTheme, themeById } from './themes.ts';
import { readXlsx, writeXlsx, type CellValue, type SheetData, type WriteColumn } from './xlsx.ts';

type Field = 'kind' | 'text' | 'a1' | 'a2' | 'a3' | 'a4' | 'correct' | 'clip' | 'start' | 'length' | 'video' | 'picture' | 'reveal' | 'grid' | 'time' | 'points';

const SHAPE_WORDS = ['▲', '●', '■', '★'];
const COLUMNS: { field: Field; header: string; col: WriteColumn }[] = [
  { field: 'kind', header: 'Type', col: { width: 10, list: ['song', 'singer', 'band', 'other'] } },
  { field: 'text', header: 'Question', col: { width: 30, text: true } },
  ...ANSWER_STYLES.map((s, i) => ({
    field: `a${i + 1}` as Field,
    header: `Answer ${i + 1}  ${SHAPE_WORDS[i]} ${s.name}`,
    col: { width: 22, text: true, color: s.color },
  })),
  { field: 'correct', header: 'Correct (1-4)', col: { width: 10, list: ['1', '2', '3', '4'] } },
  { field: 'clip', header: 'YouTube link or audio file', col: { width: 34, text: true } },
  { field: 'start', header: 'Start (m:ss)', col: { width: 9, text: true } },
  { field: 'length', header: 'Play seconds', col: { width: 9 } },
  { field: 'video', header: 'Show video (yes/no)', col: { width: 10, list: ['no', 'yes'] } },
  { field: 'picture', header: 'Picture link', col: { width: 30, text: true } },
  { field: 'reveal', header: 'Picture reveal', col: { width: 10, list: ['tiles', 'blur', 'none'] } },
  { field: 'grid', header: 'Pieces (2-8)', col: { width: 9 } },
  { field: 'time', header: 'Seconds to answer', col: { width: 10 } },
  { field: 'points', header: 'Points', col: { width: 8 } },
];

/** Words in a header that identify each column, so columns can be renamed, reordered or left out. Checked in this order. */
const HEADER_WORDS: [Field, RegExp][] = [
  ['a1', /^(answer|option|choice)\s*(1|a)\b|\b(orange|triangle)\b/],
  ['a2', /^(answer|option|choice)\s*(2|b)\b|\b(teal|circle)\b/],
  ['a3', /^(answer|option|choice)\s*(3|c)\b|\b(purple|square)\b/],
  ['a4', /^(answer|option|choice)\s*(4|d)\b|\b(pink|star)\b/],
  ['correct', /correct|right|solution/],
  ['start', /start|from/],
  ['length', /length|duration|play\s*(sec|for|time)|clip\s*sec/],
  ['video', /video/],
  ['reveal', /reveal|effect/],
  ['grid', /piece|grid|tile/],
  ['picture', /picture|image|photo/],
  ['clip', /youtube|audio|clip|link|track|music|url|song file/],
  ['kind', /^(type|kind|category)/],
  ['time', /second|time|timer/],
  ['points', /point|score/],
  ['text', /question|text/],
];

const clean = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v).trim());
const yes = (v: CellValue | undefined) => v === true || /^(yes|y|true|1|x|✓|✔|ja|jā|taip|da|si|sí|oui)$/i.test(clean(v));

export function formatClock(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round((s - m * 60) * 10) / 10;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

/** "1:30", "90", "1m30s" or an Excel time cell -> seconds. */
export function parseClock(v: CellValue | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v >= 1 || v === 0) return v;
    // Excel turned "1:30" into a time of day (1 h 30 min). People mean minutes:seconds here.
    const secs = Math.round(v * 86400);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return s === 0 ? h * 60 + m : h * 3600 + m * 60 + s;
  }
  const t = String(v).trim().toLowerCase();
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  let m = t.match(/^(\d+):(\d{1,2}(?:[.,]\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2].replace(',', '.'));
  m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = t.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/);
  if (m && (m[1] || m[2])) return Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return null;
}

function parseKind(v: string): QuestionKind | null {
  const t = v.toLowerCase();
  if (!t) return null;
  if (/song|🎵|track|title|melod/.test(t)) return 'song';
  if (/sing|artist|🎤|voice|perform/.test(t)) return 'singer';
  if (/band|group|photo|picture|🖼/.test(t)) return 'band';
  if (/other|question|general|\?/.test(t)) return 'other';
  return null;
}

function parseCorrect(v: CellValue | undefined, answers: string[]): number | null {
  const t = clean(v).toLowerCase();
  if (!t) return null;
  if (/^[1-4](\.0+)?$/.test(t)) return Number(t) - 1;
  if (/^[a-d]$/.test(t)) return t.charCodeAt(0) - 97;
  const byStyle = ANSWER_STYLES.findIndex((s) => s.name.toLowerCase().split(' ').some((w) => t.includes(w)));
  if (byStyle >= 0) return byStyle;
  const byText = answers.findIndex((a) => a.trim().toLowerCase() === t);
  return byText >= 0 ? byText : null;
}

// ---------- export ----------

export function quizToXlsx(quiz: Pick<Quiz, 'title' | 'description' | 'settings' | 'questions'>): Uint8Array {
  const rows: CellValue[][] = [COLUMNS.map((c) => c.header)];
  for (const q of quiz.questions) {
    const v: Record<Field, CellValue> = {
      kind: q.kind,
      text: q.text,
      a1: q.answers[0] ?? '',
      a2: q.answers[1] ?? '',
      a3: q.answers[2] ?? '',
      a4: q.answers[3] ?? '',
      correct: q.correct + 1,
      clip: q.media.source === 'none' ? '' : q.media.url,
      start: q.media.source === 'none' ? '' : formatClock(q.media.start),
      length: q.media.source === 'none' ? null : q.media.duration,
      video: q.media.source === 'youtube' ? (q.media.showVideo ? 'yes' : 'no') : '',
      picture: q.image?.url ?? '',
      reveal: q.image?.reveal ?? '',
      grid: q.image ? q.image.grid : null,
      time: q.timeLimit,
      points: q.points,
    };
    rows.push(COLUMNS.map((c) => v[c.field]));
  }
  const s = quiz.settings;
  const settingRows: CellValue[][] = [
    ['Setting', 'Value', 'Notes'],
    ['Quiz title', quiz.title, ''],
    ['Description', quiz.description, ''],
    ['Default seconds to answer', s.defaultTime, 'Used when a question leaves "Seconds to answer" empty'],
    ['Default points', s.defaultPoints, 'Used when a question leaves "Points" empty'],
    ['Bonus for first correct answer', s.firstBonus, ''],
    ['Bingo numbers', s.bingoMax, 'Highest number, 10 to 99 (75 = B-I-N-G-O cards). Can also be changed during the game.'],
    ['Theme', themeById(s.theme).name, `${THEMES.map((t) => t.name).join(', ')}. Can also be changed during the game.`],
    ['Play as', s.playAs, 'individual, or groups (tables play together). Can also be changed during the game.'],
    ['Group score', s.groupScoring, 'sum, or average (per member)'],
    ['Show answers on phones', s.answersOnPhones ? 'yes' : 'no', 'no = phones show only the coloured shapes'],
    ['Reveal automatically', s.autoReveal ? 'yes' : 'no', 'when time is up or everyone has answered'],
  ];
  const help: CellValue[][] = [
    ['How to fill in this file'],
    ['One row per question on the Questions sheet. Empty rows are skipped.'],
    ['Type: song, singer, band or other.'],
    ['Answers: 2 to 4. On the phones each answer is a coloured shape: 1 orange triangle, 2 teal circle, 3 purple square, 4 pink star.'],
    ['Correct: the number of the right answer (1-4). A-D, the colour, the shape or the answer text also work.'],
    ['YouTube link or audio file: paste a YouTube link, or the link of an audio file. Leave empty for picture-only questions.'],
    ['Start (m:ss): where the clip starts, e.g. 1:05. Play seconds: how long it plays.'],
    ['Show video: yes shows the YouTube video on the big screen while it plays. It is always shown at the reveal.'],
    ['Picture link: a web address of a picture. Picture reveal: tiles (piece by piece), blur (blurry to sharp) or none. Pieces: 2-8 per side.'],
    ['Seconds to answer and Points: leave empty to use the defaults on the Settings sheet.'],
    ['Uploaded audio files and pictures: upload them in the quiz editor after importing.'],
    ['Import: Presenter > Import, then choose this file.'],
  ];
  return writeXlsx([
    { name: 'Questions', columns: COLUMNS.map((c) => c.col), rows, header: true },
    { name: 'Settings', columns: [{ width: 32 }, { width: 30, text: true }, { width: 52 }], rows: settingRows, header: true },
    { name: 'Help', columns: [{ width: 120 }], rows: help, header: true },
  ]);
}

export function templateXlsx(): Uint8Array {
  const base = { start: 0, duration: 15, showVideo: false };
  const q = (p: Partial<Question>): Question => ({
    id: '',
    kind: 'song',
    text: '',
    answers: [],
    correct: 0,
    timeLimit: DEFAULT_SETTINGS.defaultTime,
    points: DEFAULT_SETTINGS.defaultPoints,
    media: { source: 'none', url: '', ...base },
    image: null,
    ...p,
  });
  return quizToXlsx({
    title: 'My Musical Bingo night',
    description: '',
    settings: DEFAULT_SETTINGS,
    questions: [
      q({
        kind: 'song',
        text: 'What is this song?',
        answers: ['Bohemian Rhapsody', "Don't Stop Me Now", 'Somebody to Love', 'We Will Rock You'],
        correct: 0,
        media: { source: 'youtube', url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ', ...base, start: 0, duration: 15 },
      }),
      q({
        kind: 'singer',
        text: 'Who is singing?',
        answers: ['Adele', 'Amy Winehouse', 'Duffy', 'Joss Stone'],
        correct: 1,
        media: { source: 'audio', url: 'https://example.com/clips/singer-clip.mp3', ...base, start: 25, duration: 12 },
      }),
      q({
        kind: 'band',
        text: 'Which band is this?',
        answers: ['ABBA', 'Boney M.', 'Bee Gees'],
        correct: 0,
        image: { url: 'https://example.com/band-photo.jpg', reveal: 'tiles', grid: 4 },
        timeLimit: 30,
        points: 150,
      }),
    ],
  });
}

// ---------- import ----------

export interface SheetImport {
  quiz: { title: string; description: string; settings: QuizSettings; questions: Omit<Question, 'id'>[] };
  warnings: string[];
}

function findSheet(sheets: SheetData[], re: RegExp) {
  return sheets.find((s) => re.test(s.name.trim().toLowerCase()));
}

function readSettings(sheet: SheetData | undefined): { title: string; description: string; settings: QuizSettings } {
  const s: QuizSettings = { ...DEFAULT_SETTINGS };
  let title = '';
  let description = '';
  for (const row of sheet?.rows || []) {
    const key = clean(row[0]).toLowerCase();
    const v = row[1];
    const n = Number(clean(v));
    if (!key || v === null || v === undefined || clean(v) === '') continue;
    if (/title|name/.test(key)) title = clean(v);
    else if (/descr/.test(key)) description = clean(v);
    else if (/bonus|first/.test(key)) Number.isFinite(n) && (s.firstBonus = n);
    else if (/second|time/.test(key) && !/reveal/.test(key)) Number.isFinite(n) && (s.defaultTime = n);
    else if (/point/.test(key)) Number.isFinite(n) && (s.defaultPoints = n);
    else if (/bingo|number|ball/.test(key)) Number.isFinite(n) && (s.bingoMax = n);
    else if (/theme|look|holiday/.test(key)) s.theme = parseTheme(v);
    else if (/^play|team|individ/.test(key)) s.playAs = /ind|solo|single|own|alone/i.test(clean(v)) ? 'individual' : 'groups';
    else if (/group/.test(key)) s.groupScoring = /av/i.test(clean(v)) ? 'average' : 'sum';
    else if (/phone/.test(key)) s.answersOnPhones = yes(v);
    else if (/reveal|auto/.test(key)) s.autoReveal = yes(v);
  }
  return { title, description, settings: s };
}

/** Reads a quiz from an .xlsx file. Throws with a readable message if the file can't be used. */
/** The first row (of the first 10) that names the question and at least two other known columns. */
function findQuizHeader(sheet: SheetData): { headerRow: number; map: Map<Field, number> } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 10); r++) {
    const m = new Map<Field, number>();
    sheet.rows[r].forEach((cell, c) => {
      const h = clean(cell).toLowerCase();
      if (!h) return;
      const hit = HEADER_WORDS.find(([f, re]) => !m.has(f) && re.test(h));
      if (hit) m.set(hit[0], c);
    });
    if (m.size >= 3 && m.has('text')) return { headerRow: r, map: m };
  }
  return null;
}

/**
 * Reads a quiz from an .xlsx file: either a quiz sheet (one row per question with its answers, like the template)
 * or a song list (title, artist, question, link), for which the wrong answers are taken from the other songs.
 * Throws with a readable message if the file can't be used.
 */
export function xlsxToQuiz(data: Uint8Array, fileName = ''): SheetImport {
  const sheets = readXlsx(data);
  const named = findSheet(sheets, /question|quiz|vraag|frage|pytan|klausim|jautāj|вопрос/);
  const qSheet = [named, ...sheets].find((s) => s && findQuizHeader(s));
  const { title, description, settings } = readSettings(findSheet(sheets, /setting|option/));
  const quizTitle = title || fileName.replace(/\.[^.]+$/, '').replace(/\.musicalbingo$/i, '').trim() || 'Imported quiz';
  if (!qSheet) {
    const songs = songListToQuiz(sheets, settings);
    if (songs) return { quiz: { title: quizTitle, description, settings, questions: songs.questions }, warnings: songs.warnings };
    throw new Error(
      'This file doesn\'t look like a quiz: no sheet has a header row with "Question", "Answer 1", "Answer 2"…, and no song list with a question column was found. Download the Excel template to see the expected columns.',
    );
  }
  const { headerRow, map } = findQuizHeader(qSheet)!;
  const warnings: string[] = [];
  const answerCols = (['a1', 'a2', 'a3', 'a4'] as Field[]).filter((f) => map.has(f));
  if (answerCols.length < 2) throw new Error('Could not find the answer columns. They should be called "Answer 1", "Answer 2"… (see the Excel template).');

  const questions: Omit<Question, 'id'>[] = [];
  for (let r = headerRow + 1; r < qSheet.rows.length; r++) {
    const row = qSheet.rows[r];
    const get = (f: Field) => (map.has(f) ? row[map.get(f)!] : null);
    const text = clean(get('text'));
    let answers = answerCols.map((f) => clean(get(f)));
    if (!text && answers.every((a) => !a)) continue; // empty row
    const label = `Row ${r + 1}${text ? ` ("${text.length > 40 ? text.slice(0, 40) + '…' : text}")` : ''}`;

    // Drop empty answers at the end, keep at least two.
    while (answers.length > 2 && !answers[answers.length - 1]) answers.pop();
    if (answers.filter(Boolean).length < 2) warnings.push(`${label}: needs at least 2 answers.`);

    let correct = parseCorrect(get('correct'), answers);
    if (correct === null || correct >= answers.length) {
      warnings.push(`${label}: no valid correct answer, answer 1 was chosen. Please check it.`);
      correct = 0;
    }

    const clip = clean(get('clip'));
    const yt = clip ? parseYouTube(clip) : null;
    const startCell = get('start');
    let start = parseClock(startCell);
    if (startCell !== null && clean(startCell) !== '' && start === null) warnings.push(`${label}: start time "${clean(startCell)}" not understood, starting at 0:00.`);
    if (start === null) start = yt?.start ?? 0;
    if (clip && !yt && !/^(https?:\/\/|\/uploads\/)/i.test(clip)) warnings.push(`${label}: "${clip.slice(0, 50)}" is not a YouTube link or web address.`);

    const picture = clean(get('picture'));
    const reveal = clean(get('reveal')).toLowerCase();
    const kindText = clean(get('kind'));
    const kind = parseKind(kindText) ?? (picture && !clip ? 'band' : clip ? 'song' : 'other');
    if (kindText && !parseKind(kindText)) warnings.push(`${label}: type "${kindText}" not known, used "${kind}".`);

    const num = (f: Field) => {
      const v = clean(get(f));
      return v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
    };
    questions.push({
      kind,
      text,
      answers,
      correct,
      timeLimit: num('time') ?? settings.defaultTime,
      points: num('points') ?? settings.defaultPoints,
      media: {
        source: clip ? (yt ? 'youtube' : 'audio') : 'none',
        url: clip,
        start,
        duration: num('length') ?? 15,
        showVideo: yes(get('video')),
      },
      image: picture
        ? { url: picture, reveal: reveal.startsWith('b') ? 'blur' : reveal.startsWith('n') ? 'none' : 'tiles', grid: num('grid') ?? 4 }
        : null,
    });
  }
  if (!questions.length) throw new Error(`No questions found on the "${qSheet.name}" sheet.`);
  return {
    quiz: {
      title: quizTitle,
      description,
      settings,
      questions,
    },
    warnings,
  };
}

// ---------- song lists ----------
// A playlist / run sheet: one row per song with its title, artist, a question ("Name of Song", "Name of Band"…)
// and a YouTube link. The right answer comes from the row; the wrong answers from other songs in the list.

type Ask = 'song' | 'singer' | 'band' | 'other';

/** What a question cell asks for. null = not a quiz question ("BEST DANCER ON THE FLOOR"). */
export function classifyAsk(text: string): Ask | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  if (/year|когда|год|movie|film|cartoon|мульт|фильм|compos|writer|author|автор|композ/.test(t)) return 'other';
  if (/band|group|групп/.test(t)) return 'band';
  if (/artist|singer|who\b|perform|исполн|певе|певи|кто/.test(t)) return 'singer';
  if (/song|title|track|n[am]{2}e\b|песн|назв/.test(t)) return 'song';
  return null;
}

/** Small seeded random generator, so importing the same file twice gives the same answers. */
function seeded(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tidy = (v: CellValue | undefined) => clean(v).replace(/\s+/g, ' ');
const isLabel = (s: string) => !s || /^[-–—?x]$|^\d+[a-z]?$/i.test(s);

function songListToQuiz(sheets: SheetData[], settings: QuizSettings): { questions: Omit<Question, 'id'>[]; warnings: string[] } | null {
  // The question column: cells that read like a quiz question, and the same few phrases over and over
  // ("Name of Song", "Name of Band"…). Song titles can contain "song" too, but they are all different.
  let best: { sheet: SheetData; qCol: number; count: number } | null = null;
  for (const sheet of sheets) {
    const hits: string[][] = [];
    for (const row of sheet.rows)
      row.forEach((c, i) => {
        if (typeof c === 'string' && classifyAsk(c) && classifyAsk(c) !== 'other') (hits[i] ||= []).push(tidy(c).toLowerCase());
      });
    hits.forEach((list, i) => {
      const score = list.length - new Set(list).size;
      if (list.length >= 3 && score >= 1 && (!best || score > best.count)) best = { sheet, qCol: i, count: score };
    });
  }
  if (!best) return null;
  const { sheet, qCol } = best as { sheet: SheetData; qCol: number };
  const rows = sheet.rows;

  // Optional header row naming the columns.
  let titleCol = -1;
  let artistCol = -1;
  let linkCol = -1;
  // Whole cell only ("Title", "Song title", "Artist / Band"), so data like "Song Four" or "Band?" isn't taken for a header.
  const TITLE_H = /^(song|title|track|song title|song name|track title|песня|название)\s*:?$/i;
  const ARTIST_H = /^(artist|singer|band|performer|artist\s*\/\s*band|band\s*\/\s*artist|исполнитель)\s*:?$/i;
  const headerRow = rows.slice(0, 10).findIndex((r) => r.some((c) => TITLE_H.test(clean(c))) && r.some((c) => ARTIST_H.test(clean(c))));
  if (headerRow >= 0) {
    rows[headerRow].forEach((c, i) => {
      const h = clean(c).toLowerCase();
      if (titleCol < 0 && TITLE_H.test(h)) titleCol = i;
      else if (artistCol < 0 && ARTIST_H.test(h)) artistCol = i;
      else if (linkCol < 0 && /link|youtube|url|ссылк/.test(h)) linkCol = i;
    });
  }

  const questionRows = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => i !== headerRow && typeof r[qCol] === 'string' && classifyAsk(r[qCol] as string));
  if (linkCol < 0) {
    // The link column: most YouTube / web links.
    const counts: number[] = [];
    for (const { r } of questionRows) r.forEach((c, i) => i !== qCol && /^https?:\/\/|youtu/i.test(clean(c)) && (counts[i] = (counts[i] || 0) + 1));
    linkCol = counts.reduce((b, n, i) => (n > (counts[b] || 0) ? i : b), -1);
  }
  if (titleCol < 0 || artistCol < 0) {
    // Without a header: the first two columns, left to right, that hold varied text on the question rows (title, then artist).
    const textCols: number[] = [];
    const width = Math.max(...questionRows.map(({ r }) => r.length));
    for (let c = 0; c < width && textCols.length < 2; c++) {
      if (c === qCol || c === linkCol) continue;
      const vals = questionRows.map(({ r }) => tidy(r[c])).filter((v) => typeof v === 'string' && !isLabel(v) && !/^https?:/i.test(v) && Number.isNaN(Number(v)));
      if (vals.length >= questionRows.length * 0.6 && new Set(vals.map((v) => v.toLowerCase())).size >= vals.length * 0.6) textCols.push(c);
    }
    if (textCols.length < 2) return null;
    [titleCol, artistCol] = textCols;
  }

  // A song row has a question, a link, or a number in front of the title ("12", "15a"). That leaves out headings like
  // "Musical Bingo | 2026.02.10". Every song row (also karaoke and bonus rounds) feeds the pool of wrong answers.
  const isSongRow = (r: CellValue[], i: number) =>
    i !== headerRow &&
    !isLabel(tidy(r[titleCol])) &&
    !isLabel(tidy(r[artistCol])) &&
    (classifyAsk(tidy(r[qCol])) !== null || (linkCol >= 0 && !!clean(r[linkCol])) || r.slice(0, Math.min(titleCol, artistCol)).some((c) => /^\d+[a-z]?$/i.test(tidy(c))));
  const songs = rows
    .map((r, i) => ({ i, ok: isSongRow(r, i), title: tidy(r[titleCol]), artist: tidy(r[artistCol]), ask: classifyAsk(tidy(r[qCol])) }))
    .filter((s) => s.ok);
  const uniq = (list: string[]) => [...new Map(list.filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
  const titles = uniq(songs.map((s) => s.title));
  const bands = uniq(songs.filter((s) => s.ask === 'band').map((s) => s.artist));
  const singers = uniq(songs.filter((s) => s.ask !== 'band').map((s) => s.artist));
  const allArtists = uniq(songs.map((s) => s.artist));

  const pick = (rand: () => number, right: string, preferred: string[], fallback: string[]) => {
    const out: string[] = [];
    const used = new Set([right.toLowerCase()]);
    for (const pool of [preferred, fallback]) {
      const left = pool.filter((v) => !used.has(v.toLowerCase()));
      while (out.length < 3 && left.length) {
        const v = left.splice(Math.floor(rand() * left.length), 1)[0];
        used.add(v.toLowerCase());
        out.push(v);
      }
    }
    return out;
  };

  const warnings: string[] = [];
  const skipped: string[] = [];
  const fillIn: string[] = [];
  const questions: Omit<Question, 'id'>[] = [];
  const TEXT: Record<Exclude<Ask, 'other'>, string> = { song: 'What is this song?', singer: 'Who is singing?', band: 'Which band is this?' };

  for (let i = 0; i < rows.length; i++) {
    if (i === headerRow) continue;
    const r = rows[i];
    const title = tidy(r[titleCol]);
    const artist = tidy(r[artistCol]);
    const askText = tidy(r[qCol]);
    const ask = classifyAsk(askText);
    const num = tidy(r[0]);
    const name = `${/^\d+[a-z]?$/i.test(num) && titleCol !== 0 ? `${num} ` : ''}${title || artist}`;
    const link = linkCol >= 0 ? clean(r[linkCol]) : '';
    if (!ask) {
      if (isSongRow(r, i)) skipped.push(`${name}${askText ? ` (${askText})` : ''}`);
      continue;
    }
    if (isLabel(title) && isLabel(artist)) {
      skipped.push(`row ${i + 1} (${askText}: no song)`);
      continue;
    }
    const yt = parseYouTube(link);
    const media = { source: yt ? ('youtube' as const) : link ? ('audio' as const) : ('none' as const), url: link, start: yt?.start ?? 0, duration: 15, showVideo: false };
    if (!link) warnings.push(`Row ${i + 1} (${title}): no YouTube link.`);

    if (ask === 'other') {
      fillIn.push(`${title} (${askText})`);
      questions.push({ kind: 'other', text: askText.replace(/\s*\?*$/, '?'), answers: ['', '', '', ''], correct: 0, timeLimit: settings.defaultTime, points: settings.defaultPoints, media, image: null });
      continue;
    }
    const right = ask === 'song' ? title : artist;
    if (isLabel(right)) {
      skipped.push(`${name} (${askText}: answer missing)`);
      continue;
    }
    const rand = seeded(`${title}|${artist}|${ask}`);
    const wrong = ask === 'song' ? pick(rand, right, titles, []) : pick(rand, right, ask === 'band' ? bands : singers, allArtists);
    const correct = Math.floor(rand() * (wrong.length + 1));
    const answers = [...wrong];
    answers.splice(correct, 0, right);
    if (answers.length < 4) warnings.push(`Row ${i + 1} (${title}): only ${answers.length} answers, the list is too short for more.`);
    questions.push({ kind: ask, text: TEXT[ask], answers, correct, timeLimit: settings.defaultTime, points: settings.defaultPoints, media, image: null });
  }
  if (!questions.length) return null;

  warnings.unshift(`Built ${questions.length} questions from the song list on the "${sheet.name}" sheet. The wrong answers were picked from other songs in your list: check them in the editor.`);
  if (fillIn.length) warnings.push(`Fill in the answers for: ${fillIn.join('; ')}.`);
  if (skipped.length) warnings.push(`Skipped (no quiz question): ${skipped.join('; ')}.`);
  return { questions, warnings };
}
