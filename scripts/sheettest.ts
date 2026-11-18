// Checks Excel import/export without a server:  npx tsx scripts/sheettest.ts [file.xlsx ...]
// With file names, it also imports those files and prints what it found.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClock, quizToXlsx, templateXlsx, xlsxToQuiz } from '../shared/quizSheet.ts';
import { DEFAULT_SETTINGS, type Question } from '../shared/types.ts';
import { readXlsx, writeXlsx } from '../shared/xlsx.ts';

// 1. The template imports cleanly.
const t = xlsxToQuiz(templateXlsx(), 'template.xlsx');
assert.deepEqual(t.warnings, []);
assert.equal(t.quiz.title, 'My Musical Bingo night');
assert.equal(t.quiz.questions.length, 3);
assert.equal(t.quiz.questions[0].media.source, 'youtube');
assert.equal(t.quiz.questions[1].media.source, 'audio');
assert.equal(t.quiz.questions[1].media.start, 25);
assert.equal(t.quiz.questions[1].correct, 1);
assert.equal(t.quiz.questions[2].image?.grid, 4);
assert.equal(t.quiz.questions[2].answers.length, 3);
assert.equal(t.quiz.questions[2].points, 150);
console.log('✔ template imports without warnings');

// 2. Export -> import keeps every field, including awkward text.
const q = (p: Partial<Question>): Question => ({
  id: 'x',
  kind: 'other',
  text: '',
  answers: ['a', 'b'],
  correct: 0,
  timeLimit: 20,
  points: 100,
  media: { source: 'none', url: '', start: 0, duration: 15, showVideo: false },
  image: null,
  ...p,
});
const quiz = {
  title: 'Rock & Roll <night> "special" 🎸',
  description: 'Line one\nLine two',
  settings: { ...DEFAULT_SETTINGS, defaultTime: 25, firstBonus: 75, bingoMax: 90 as const, groupScoring: 'average' as const, answersOnPhones: false },
  questions: [
    q({ kind: 'song', text: 'Ąžuolas & ﾟ "quotes" <tags>', answers: ['1999', '3/4', '1:30', 'TRUE'], correct: 3, media: { source: 'youtube', url: 'https://youtu.be/fJ9rUzIMcZQ?t=95', start: 95.5, duration: 12, showVideo: true } }),
    q({ kind: 'band', text: 'Who?', answers: ['A', 'B', 'C'], correct: 2, timeLimit: 45, points: 250, image: { url: '/uploads/abc.jpg', reveal: 'blur', grid: 6 } }),
    q({ kind: 'singer', text: 'Voice', answers: ['x', 'y'], correct: 1, media: { source: 'audio', url: '/uploads/clip.mp3', start: 0, duration: 30, showVideo: false } }),
  ],
};
const back = xlsxToQuiz(quizToXlsx(quiz), 'ignored.xlsx');
assert.deepEqual(back.warnings, []);
assert.equal(back.quiz.title, quiz.title);
assert.equal(back.quiz.description, quiz.description);
assert.deepEqual(back.quiz.settings, quiz.settings);
assert.deepEqual(
  back.quiz.questions,
  quiz.questions.map(({ id, ...rest }) => rest),
);
console.log('✔ export → import round trip keeps everything');

// 3. A hand-made sheet: other column names and order, letters/colours/text for the correct answer, Excel times, empty rows.
const hand = writeXlsx([
  {
    name: 'Sheet1',
    columns: [],
    rows: [
      ['My quiz night'],
      ['Question', 'Option A', 'Option B', 'Option C', 'Right answer', 'Link', 'Start', 'Points', 'Category'],
      ['Song 1?', 'One', 'Two', 'Three', 'b', 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ&t=1m5s', null, 200, 'Song'],
      [],
      ['Song 2?', 'One', 'Two', 'Three', 'purple', 'https://youtu.be/fJ9rUzIMcZQ', 0.0625, null, 'Artist'],
      ['Song 3?', 'One', 'Two', 'Three', 'three', null, '0:45', null, null],
      ['Song 4?', 'One', 'Two', null, 7, 'not a link', 'soon', null, 'weird'],
    ],
  },
]);
const h = xlsxToQuiz(hand, 'Friday night.xlsx');
assert.equal(h.quiz.title, 'Friday night');
assert.equal(h.quiz.questions.length, 4);
const [h1, h2, h3, h4] = h.quiz.questions;
assert.equal(h1.correct, 1);
assert.equal(h1.media.start, 65, 'start taken from the YouTube link');
assert.equal(h1.points, 200);
assert.equal(h2.correct, 2);
assert.equal(h2.kind, 'singer');
assert.equal(h2.media.start, 90, 'Excel time 1:30 means 1 min 30 s');
assert.equal(h3.correct, 2, 'matched by answer text');
assert.equal(h3.media.source, 'none');
assert.equal(h3.media.start, 45);
assert.equal(h3.kind, 'other');
assert.equal(h4.answers.length, 2, 'trailing empty answer dropped');
assert.equal(h4.correct, 0);
assert.equal(h.warnings.length, 4, h.warnings.join('\n'));
assert.match(h.warnings.join('\n'), /Row 7.*correct/);
console.log('✔ hand-made sheet imports, with', h.warnings.length, 'warnings for the bad row');

// 4. Clock parsing and bad files.
assert.equal(parseClock('1:05'), 65);
assert.equal(parseClock('2m'), 120);
assert.equal(parseClock(30), 30);
assert.equal(parseClock(1 / 1440), 1, 'typed "0:01", which Excel stores as 0 h 1 min, means 0 min 1 s');
assert.equal(parseClock(90 / 86400), 90, 'typed "0:01:30"');
assert.throws(() => xlsxToQuiz(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), /old \.xls/);
assert.throws(() => xlsxToQuiz(new TextEncoder().encode('hello')), /not an Excel/);
assert.throws(() => xlsxToQuiz(writeXlsx([{ name: 'Questions', columns: [], rows: [['Question', 'Answer 1', 'Answer 2']] }])), /No questions/);
assert.throws(
  () => xlsxToQuiz(writeXlsx([{ name: 'Songs', columns: [], rows: [[1, 'Always', 'Bon Jovi', '90s', 'https://youtu.be/x']] }])),
  /doesn't look like a quiz/,
  'a song list without headers is refused, not turned into junk questions',
);
console.log('✔ clock parsing and error messages');

// 5. A song list / run sheet without headers: number, title, artist, notes, question, link.
const list = writeXlsx([
  { name: 'Notes', columns: [], rows: [['Sponsors'], ['Someone', 'not a song']] },
  {
    name: 'Run sheet',
    columns: [],
    rows: [
      [null, 'Musical Bingo', '2026.01.01'],
      ['-', 'Welcome everyone'],
      [1, 'Song One', 'Ana Lee', 'fun', 'Name of Song', 'https://youtu.be/aaaaaaaaaaa'],
      [2, 'Song Two', 'The Foxes', 'slow', 'Name of Band', 'https://youtu.be/bbbbbbbbbbb'],
      [3, 'Song Three', 'Mo Rivers', null, 'Name of Artist', 'https://youtu.be/ccccccccccc'],
      ['3a', 'Karaoke Song', 'Night Owls', 'KARAOKE'],
      [4, ' Song  Four ', 'Blue Harbour', null, 'Band?', 'https://youtu.be/ddddddddddd'],
      [5, 'Song Five', 'Kit Vale', null, 'What Year this song?', 'https://youtu.be/eeeeeeeeeee'],
      [6, 'Song Six', 'Paper Kites', null, 'Nmae of Song', null],
      [null, null, 'PAUSE 10 min'],
      [7, 'Song Seven', 'Ana Lee', null, 'Name of Singer', 'https://youtu.be/fffffffffff'],
      [8, null, null, null, 'Name of Song'],
    ],
  },
]);
const sl = xlsxToQuiz(list, 'Pub night.xlsx');
const sq = sl.quiz.questions;
assert.equal(sl.quiz.title, 'Pub night');
assert.equal(sq.length, 7);
const right = (q: (typeof sq)[number]) => q.answers[q.correct];
assert.deepEqual(sq.map((q) => q.kind), ['song', 'band', 'singer', 'band', 'other', 'song', 'singer']);
assert.deepEqual(sq.map(right), ['Song One', 'The Foxes', 'Mo Rivers', 'Blue Harbour', '', 'Song Six', 'Ana Lee']);
assert.equal(sq[0].media.source, 'youtube');
assert.equal(sq[5].media.source, 'none');
for (const q of sq.filter((q) => q.kind !== 'other')) {
  assert.equal(q.answers.length, 4);
  assert.equal(new Set(q.answers.map((a) => a.toLowerCase())).size, 4, 'no duplicate answers');
  assert.ok(!q.answers.some((a) => /Musical Bingo|2026|Welcome|PAUSE/.test(a)), 'headings never become answers');
}
assert.ok(sq[1].answers.includes('Blue Harbour'), 'band questions get the other known bands (from band questions) first');
assert.ok(sq[0].answers.every((a) => a.startsWith('Song') || a === 'Karaoke Song'), 'song questions get titles');
assert.equal(sq[6].answers.filter((a) => a === 'Ana Lee').length, 1, 'an artist with two songs appears once');
assert.deepEqual(xlsxToQuiz(list, 'Pub night.xlsx').quiz.questions, sq, 'same file, same answers');
assert.match(sl.warnings.join('\n'), /Built 7 questions/);
assert.match(sl.warnings.join('\n'), /Skipped.*3a Karaoke Song/);
assert.match(sl.warnings.join('\n'), /Fill in the answers for: Song Five/);
console.log('✔ song list becomes questions, wrong answers from the other songs');

for (const f of process.argv.slice(2)) {
  const data = new Uint8Array(readFileSync(f));
  console.log(`\n${f}: sheets ${readXlsx(data).map((s) => `${s.name} (${s.rows.length} rows)`).join(', ')}`);
  const r = xlsxToQuiz(data, f.split(/[\\/]/).pop());
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
}
