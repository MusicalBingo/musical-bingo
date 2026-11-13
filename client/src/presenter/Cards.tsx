import { useState } from 'react';
import { FREE, cardId, makeCard, normalizeSeries } from '../../../shared/bingo.ts';
import { go } from './api.ts';

export function BingoCardView({ grid, marked, id, title, compact }: { grid: number[][]; marked?: boolean[][]; id: string; title?: string; compact?: boolean }) {
  return (
    <div className={`bingo-card ${compact ? 'compact' : ''}`}>
      {title && <div className="bc-title">{title}</div>}
      <div className="bc-grid">
        {'BINGO'.split('').map((l) => (
          <div key={l} className="bc-head">
            {l}
          </div>
        ))}
        {grid.flatMap((row, r) =>
          row.map((v, c) => (
            <div key={`${r}-${c}`} className={`bc-cell ${v === FREE ? 'free' : ''} ${marked?.[r][c] ? 'marked' : ''}`}>
              {v === FREE ? '★' : v}
            </div>
          )),
        )}
      </div>
      <div className="bc-id">Card {id}</div>
    </div>
  );
}

export function Cards() {
  const [series, setSeries] = useState('A');
  const [from, setFrom] = useState(1);
  const [count, setCount] = useState(20);
  const [perPage, setPerPage] = useState(4);
  const [title, setTitle] = useState('🎵 Musical Bingo');

  const s = normalizeSeries(series);
  const n = Math.max(1, Math.min(500, count));
  const cards = Array.from({ length: n }, (_, i) => from + i);
  const pages: number[][] = [];
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage));

  return (
    <div className="cards-page">
      <div className="page no-print">
        <header className="topbar">
          <div className="row">
            <button className="btn" onClick={() => go('/')}>
              ← Home
            </button>
            <h1>Print bingo cards</h1>
          </div>
          <button className="btn primary big" onClick={() => window.print()}>
            🖨 Print {n} cards
          </button>
        </header>
        <div className="panel form">
          <p className="muted">
            75-ball cards (B-I-N-G-O). Every card has a number like <strong>{cardId(s, from)}</strong>. During the game, type that number into
            "Check a printed card" to see right away if the card really has bingo. Use the same series letter and numbers each night and you can
            reuse the printed cards. Use a new series letter when you want a fresh set.
          </p>
          <div className="grid3">
            <label className="field">
              <span>Series (letters/numbers)</span>
              <input value={series} onChange={(e) => setSeries(e.target.value)} maxLength={8} />
            </label>
            <label className="field">
              <span>First card number</span>
              <input type="number" min={1} value={from} onChange={(e) => setFrom(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="field">
              <span>How many cards</span>
              <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
            </label>
            <label className="field">
              <span>Cards per A4 page</span>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                <option value={1}>1 (large)</option>
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={6}>6</option>
              </select>
            </label>
            <label className="field">
              <span>Title on the card</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
        </div>
        <h3>Preview</h3>
      </div>
      <div className="print-pages">
        {pages.map((p, i) => (
          <div key={i} className={`print-page per-${perPage}`}>
            {p.map((num) => (
              <BingoCardView key={num} grid={makeCard(s, num)} id={cardId(s, num)} title={title} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
