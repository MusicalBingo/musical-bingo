// File-based storage: quizzes as JSON files, uploads as files, saved games and results.
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  BINGO_LIMIT,
  BINGO_MIN,
  DEFAULT_SETTINGS,
  type Question,
  type Quiz,
  type QuizSettings,
  type QuizSummary,
} from '../shared/types.ts';
import { clamp } from '../shared/util.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const QUIZ_DIR = path.join(DATA_DIR, 'quizzes');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const GAME_DIR = path.join(DATA_DIR, 'games');
export const RESULT_DIR = path.join(DATA_DIR, 'results');

for (const d of [QUIZ_DIR, UPLOAD_DIR, GAME_DIR, RESULT_DIR]) fs.mkdirSync(d, { recursive: true });

const quizFile = (id: string) => path.join(QUIZ_DIR, `${id.replace(/[^\w-]/g, '')}.json`);

function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function listQuizzes(): QuizSummary[] {
  return fs
    .readdirSync(QUIZ_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const q = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8')) as Quiz;
        return {
          id: q.id,
          title: q.title,
          description: q.description,
          questionCount: q.questions.length,
          updatedAt: q.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is QuizSummary => !!x)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getQuiz(id: string): Quiz | null {
  const f = quizFile(id);
  if (!fs.existsSync(f)) return null;
  return normalizeQuiz(JSON.parse(fs.readFileSync(f, 'utf8')));
}

export function saveQuiz(input: unknown, id?: string): Quiz {
  const quiz = normalizeQuiz(input);
  const existing = id ? getQuiz(id) : null;
  quiz.id = id || nanoid(10);
  quiz.createdAt = existing?.createdAt ?? Date.now();
  quiz.updatedAt = Date.now();
  writeJsonAtomic(quizFile(quiz.id), quiz);
  return quiz;
}

export function deleteQuiz(id: string): boolean {
  const f = quizFile(id);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

// ---------- validation / normalisation ----------

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function normalizeSettings(s: any): QuizSettings {
  s = s || {};
  return {
    defaultTime: clamp(Math.round(num(s.defaultTime, DEFAULT_SETTINGS.defaultTime)), 5, 300),
    defaultPoints: clamp(Math.round(num(s.defaultPoints, DEFAULT_SETTINGS.defaultPoints)), 0, 100000),
    firstBonus: clamp(Math.round(num(s.firstBonus, DEFAULT_SETTINGS.firstBonus)), 0, 100000),
    bingoMax: clamp(Math.round(num(s.bingoMax, DEFAULT_SETTINGS.bingoMax)), BINGO_MIN, BINGO_LIMIT),
    playAs: s.playAs === 'individual' ? 'individual' : 'groups',
    groupScoring: s.groupScoring === 'average' ? 'average' : 'sum',
    answersOnPhones: s.answersOnPhones !== false,
    autoReveal: s.autoReveal !== false,
  };
}

export function normalizeQuestion(q: any, settings: QuizSettings): Question {
  q = q || {};
  let answers: string[] = Array.isArray(q.answers) ? q.answers.map((a: unknown) => str(a, 120)) : [];
  answers = answers.slice(0, 4);
  while (answers.length < 2) answers.push('');
  const media = q.media || {};
  const source = ['youtube', 'audio'].includes(media.source) ? media.source : 'none';
  const img = q.image && str(q.image.url) ? q.image : null;
  return {
    id: str(q.id, 40) || nanoid(8),
    kind: ['song', 'singer', 'band', 'other'].includes(q.kind) ? q.kind : 'other',
    text: str(q.text, 300),
    answers,
    correct: clamp(Math.round(num(q.correct, 0)), 0, answers.length - 1),
    timeLimit: clamp(Math.round(num(q.timeLimit, settings.defaultTime)), 5, 300),
    points: clamp(Math.round(num(q.points, settings.defaultPoints)), 0, 100000),
    media: {
      source,
      url: str(media.url, 1000),
      start: Math.max(0, num(media.start, 0)),
      duration: clamp(num(media.duration, 15), 1, 600),
      showVideo: !!media.showVideo,
    },
    image: img
      ? {
          url: str(img.url, 1000),
          reveal: ['tiles', 'blur', 'none'].includes(img.reveal) ? img.reveal : 'tiles',
          grid: clamp(Math.round(num(img.grid, 4)), 2, 8),
        }
      : null,
  };
}

export function normalizeQuiz(input: any): Quiz {
  input = input || {};
  const settings = normalizeSettings(input.settings);
  return {
    id: str(input.id, 40),
    title: str(input.title, 120) || 'Untitled quiz',
    description: str(input.description, 1000),
    createdAt: num(input.createdAt, Date.now()),
    updatedAt: num(input.updatedAt, Date.now()),
    settings,
    questions: (Array.isArray(input.questions) ? input.questions : []).slice(0, 500).map((q: any) => normalizeQuestion(q, settings)),
  };
}
