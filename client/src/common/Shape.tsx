import type { ReactElement } from 'react';
import type { Shape } from '../../../shared/types.ts';
import { ANSWER_STYLES } from '../../../shared/types.ts';

const PATHS: Record<Shape, ReactElement> = {
  triangle: <polygon points="50,8 94,88 6,88" />,
  circle: <circle cx="50" cy="50" r="42" />,
  square: <rect x="12" y="12" width="76" height="76" rx="6" />,
  star: <polygon points="50,5 62,37 96,38 69,59 79,93 50,73 21,93 31,59 4,38 38,37" />,
};

export function ShapeIcon({ shape, size = 32, color = '#fff' }: { shape: Shape; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill={color} aria-hidden="true" style={{ flex: 'none' }}>
      {PATHS[shape]}
    </svg>
  );
}

export function AnswerIcon({ index, size = 32 }: { index: number; size?: number }) {
  const s = ANSWER_STYLES[index];
  return <ShapeIcon shape={s.shape} size={size} />;
}

export function answerColor(i: number) {
  return ANSWER_STYLES[i]?.color ?? '#555';
}
