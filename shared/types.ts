// Types and constants shared by the server and all three web apps.
import type { ThemeId } from './themes.ts';

export type QuestionKind = 'song' | 'singer' | 'band' | 'other';
export type MediaSource = 'none' | 'youtube' | 'audio';
export type ImageReveal = 'tiles' | 'blur' | 'none';

export interface QuestionMedia {
  source: MediaSource;
  /** YouTube link, or URL of an uploaded / external audio file */
  url: string;
  /** where the clip starts, in seconds */
  start: number;
  /** how many seconds of the clip to play */
  duration: number;
  /** YouTube only: show the video on the big screen (off = audio only, so the title isn't given away) */
  showVideo: boolean;
}

export interface QuestionImage {
  url: string;
  reveal: ImageReveal;
  /** tiles mode: grid size (3 = 3x3 pieces, 4 = 4x4 ...) */
  grid: number;
}

export interface Question {
  id: string;
  kind: QuestionKind;
  text: string;
  /** 2 to 4 answers */
  answers: string[];
  /** index into answers */
  correct: number;
  /** seconds players have to answer */
  timeLimit: number;
  /** points for a correct answer */
  points: number;
  media: QuestionMedia;
  image: QuestionImage | null;
}

/** smallest and largest "highest bingo number" a game can use */
export const BINGO_MIN = 10;
export const BINGO_LIMIT = 99;

export interface QuizSettings {
  defaultTime: number;
  defaultPoints: number;
  /** extra points for the first player who answers correctly */
  firstBonus: number;
  /** highest bingo ball: 75 = B-I-N-G-O cards, 90 = UK cards, or anything in between for custom cards */
  bingoMax: number;
  /** holiday look of the big screen and the phones */
  theme: ThemeId;
  /** everyone for themselves, or tables play as groups */
  playAs: 'individual' | 'groups';
  /** group score = sum of members' points, or the average per member */
  groupScoring: 'sum' | 'average';
  /** show answer texts on the phones as well as on the big screen */
  answersOnPhones: boolean;
  /** reveal automatically when time is up or everyone has answered */
  autoReveal: boolean;
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  settings: QuizSettings;
  questions: Question[];
}

export interface QuizSummary {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: QuizSettings = {
  defaultTime: 20,
  defaultPoints: 100,
  firstBonus: 50,
  bingoMax: 75,
  playAs: 'groups',
  theme: 'classic',
  groupScoring: 'sum',
  answersOnPhones: true,
  autoReveal: true,
};

export type Shape = 'triangle' | 'circle' | 'square' | 'star';

export interface AnswerStyle {
  name: string;
  shape: Shape;
  color: string;
}

/** Each answer has its own colour AND shape, so people can say "it's the purple square" across the table. */
export const ANSWER_STYLES: AnswerStyle[] = [
  { name: 'Orange Triangle', shape: 'triangle', color: '#E8590C' },
  { name: 'Teal Circle', shape: 'circle', color: '#0C8C7D' },
  { name: 'Purple Square', shape: 'square', color: '#7E3FBF' },
  { name: 'Pink Star', shape: 'star', color: '#C2337F' },
];

export const KIND_LABELS: Record<QuestionKind, string> = {
  song: 'Guess the song',
  singer: 'Guess the singer',
  band: 'Guess the band',
  other: 'Question',
};

// ---------- live game ----------

export type Phase = 'lobby' | 'number' | 'question' | 'reveal' | 'leaderboard' | 'ended';

/** A question as everyone sees it while it is open (no correct answer inside). */
export interface LiveQuestion {
  index: number;
  total: number;
  id: string;
  kind: QuestionKind;
  text: string;
  answers: string[];
  timeLimit: number;
  points: number;
  media: QuestionMedia;
  image: QuestionImage | null;
  startedAt: number;
  endsAt: number;
  closed: boolean;
}

export interface RevealInfo {
  correct: number;
  counts: number[];
  correctCount: number;
  firstCorrect: { id: string; name: string; groupName: string | null; ms: number } | null;
}

export interface PlayerRow {
  id: string;
  name: string;
  score: number;
  correct: number;
  firsts: number;
  groupId: string | null;
  connected: boolean;
}

export interface GroupRow {
  id: string;
  name: string;
  /** total points earned by members while they were in the group */
  total: number;
  members: number;
  /** what the leaderboard ranks by (total or average, per quiz settings) */
  score: number;
}

export interface PublicState {
  code: string;
  title: string;
  phase: Phase;
  serverNow: number;
  settings: QuizSettings;
  drawn: number[];
  lastNumber: number | null;
  questionCount: number;
  questionIndex: number;
  question: LiveQuestion | null;
  reveal: RevealInfo | null;
  answeredCount: number;
  players: PlayerRow[];
  groups: GroupRow[];
  announcement: { text: string; at: number } | null;
  /** bumps every time the presenter asks the display to replay the clip */
  mediaNonce: number;
  mediaStopped: boolean;
}

export interface PlayerYou {
  id: string;
  name: string;
  groupId: string | null;
  score: number;
  rank: number;
  /** answer chosen for the current question */
  answer: number | null;
  /** result of the current question, once revealed */
  result: { correct: boolean; points: number; first: boolean } | null;
}

export interface PresenterExtra {
  correct: number | null;
  liveCounts: number[];
  questions: { id: string; text: string; kind: QuestionKind; answers: string[]; correct: number }[];
  answers: { playerId: string; name: string; choice: number; ms: number }[];
}

export interface GameSummary {
  code: string;
  title: string;
  phase: Phase;
  players: number;
  createdAt: number;
}
