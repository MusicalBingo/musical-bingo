import { DEFAULT_SETTINGS, type Question, type QuestionKind, type QuizSettings } from '../../../shared/types.ts';

export const uid = () => Math.random().toString(36).slice(2, 10);

const KIND_TEXT: Record<QuestionKind, string> = {
  song: 'What is this song?',
  singer: 'Who is singing?',
  band: 'Which band is this?',
  other: '',
};

export function newQuestion(settings: QuizSettings, kind: QuestionKind = 'song'): Question {
  return {
    id: uid(),
    kind,
    text: KIND_TEXT[kind],
    answers: ['', '', '', ''],
    correct: 0,
    timeLimit: settings.defaultTime,
    points: settings.defaultPoints,
    media: { source: kind === 'band' ? 'none' : 'youtube', url: '', start: 0, duration: 15, showVideo: false },
    image: null,
  };
}

export function newQuizTemplate() {
  return {
    title: 'New Musical Bingo night',
    description: '',
    settings: DEFAULT_SETTINGS,
    questions: [newQuestion(DEFAULT_SETTINGS, 'song')],
  };
}
