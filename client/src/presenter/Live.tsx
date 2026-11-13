import { useEffect, useState } from 'react';
import { ANSWER_STYLES, KIND_LABELS } from '../../../shared/types.ts';
import { bingoLetter } from '../../../shared/util.ts';
import type { CardCheck } from '../../../shared/bingo.ts';
import { AnswerIcon, answerColor } from '../common/Shape.tsx';
import { emit, joinBaseUrl, qrUrl, serverNow, useConnection, useGameState, useTicker } from '../common/net.ts';
import { AuthError, api, getToken, go } from './api.ts';
import { BingoCardView } from './Cards.tsx';

const PHASE_TEXT: Record<string, string> = {
  lobby: 'Lobby: players are joining',
  number: 'Showing the drawn number',
  question: 'Question is running',
  reveal: 'Showing the right answer',
  leaderboard: 'Showing the leaderboard',
  ended: 'Game over: final results',
};

export function Live({ code, onAuthError }: { code: string; onAuthError: () => void }) {
  const [msg] = useGameState();
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState(false);
  const [joinBase, setJoinBase] = useState('');
  const [manual, setManual] = useState('');
  const [nextIndex, setNextIndex] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [cardId, setCardId] = useState('');
  const [card, setCard] = useState<CardCheck | null>(null);
  const [cardErr, setCardErr] = useState('');

  const connected = useConnection(async () => {
    const r = await emit('presenter:attach', { code, token: getToken() });
    if (!r.ok) {
      if (/login/i.test(r.error)) onAuthError();
      else setMissing(true);
    }
  });

  useEffect(() => {
    void joinBaseUrl().then(setJoinBase);
  }, []);

  const state = msg?.state;
  const extra = msg?.extra;
  useTicker(state?.phase === 'question' && !state.question?.closed, 250);

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setErr('');
    const r = await emit('presenter:action', { action, ...payload });
    if (!r.ok) setErr(r.error || 'Something went wrong');
    return r;
  };

  useEffect(() => {
    setNextIndex(null);
  }, [state?.questionIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'd') void act('draw');
      else if (k === 's') void act('start', { index: nextIndex ?? undefined });
      else if (k === 'r') void act('reveal');
      else if (k === 'l') void act('leaderboard');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextIndex]);

  if (missing)
    return (
      <div className="page">
        <p>Game {code} was not found. It may have been closed.</p>
        <button className="btn" onClick={() => go('/')}>
          ← Back
        </button>
      </div>
    );
  if (!state || !extra) return <div className="page muted">{connected ? 'Connecting to the game…' : 'Connecting to the server…'}</div>;

  const joinUrl = `${joinBase}/play?code=${state.code}`;
  const q = state.question;
  const qOpen = state.phase === 'question' && q && !q.closed;
  const remaining = q ? Math.max(0, Math.ceil((q.endsAt - serverNow()) / 1000)) : 0;
  const upcoming = nextIndex ?? state.questionIndex + 1;
  const hasNext = upcoming < state.questionCount;
  const online = state.players.filter((p) => p.connected).length;
  const groupName = (id: string | null) => (id ? (state.groups.find((g) => g.id === id)?.name ?? '') : '');
  const counts = state.reveal?.counts ?? extra.liveCounts;
  const maxCount = Math.max(1, ...counts);

  const primary =
    state.phase === 'number' ? 'start' : state.phase === 'question' ? 'reveal' : state.phase === 'ended' ? '' : 'draw';

  const checkCard = async () => {
    setCardErr('');
    setCard(null);
    try {
      setCard(await api<CardCheck>(`/api/games/${state.code}/card/${encodeURIComponent(cardId.trim())}`));
    } catch (e: any) {
      if (e instanceof AuthError) onAuthError();
      else setCardErr(e.message);
    }
  };

  const exportCsv = async () => {
    const res = await fetch(`/api/games/${state.code}/results.csv`, { headers: { 'x-presenter-token': getToken() } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `musical-bingo-${state.code}.csv`;
    a.click();
  };

  return (
    <div className="live">
      {!connected && <div className="offline">Reconnecting to the server…</div>}
      <header className="topbar">
        <div className="row">
          <button className="btn" onClick={() => go('/')}>
            ← Home
          </button>
          <div>
            <div className="muted small">{state.title}</div>
            <div className="row">
              <span className="game-code">{state.code}</span>
              <span className="pill">{PHASE_TEXT[state.phase]}</span>
            </div>
          </div>
        </div>
        <div className="row">
          <span className="muted small">
            {online} online / {state.players.length} players
          </span>
          <a className="btn" href={`/display?code=${state.code}`} target="_blank">
            📺 Big screen
          </a>
          <button className="btn small" onClick={exportCsv}>
            ⬇ Results CSV
          </button>
        </div>
      </header>

      {err && <div className="toast error" onClick={() => setErr('')}>{err}</div>}

      <div className="live-grid">
        {/* ---------- main flow ---------- */}
        <section className="panel flow">
          <div className="flow-buttons">
            <button className={`btn big ${primary === 'draw' ? 'primary' : ''}`} onClick={() => act('draw')} title="Shortcut: D">
              🎱 Draw number
            </button>
            <button
              className={`btn big ${primary === 'start' ? 'primary' : ''}`}
              disabled={!hasNext}
              onClick={() => act('start', { index: nextIndex ?? undefined })}
              title="Shortcut: S"
            >
              ▶ {hasNext ? `Start question ${upcoming + 1}` : 'No more questions'}
            </button>
            <button className={`btn big ${primary === 'reveal' ? 'primary' : ''}`} disabled={!q || state.phase === 'reveal'} onClick={() => act('reveal')} title="Shortcut: R">
              ✔ Show answer
            </button>
            <button className="btn big" onClick={() => act('leaderboard')} title="Shortcut: L">
              🏆 Leaderboard
            </button>
          </div>
          <div className="row small">
            <span className="muted">Next question:</span>
            <select value={upcoming} onChange={(e) => setNextIndex(Number(e.target.value))} style={{ width: 'auto', maxWidth: '100%' }}>
              {extra.questions.map((x, i) => (
                <option key={x.id} value={i}>
                  {i + 1}. {x.answers[x.correct] || x.text} {i <= state.questionIndex ? '(played)' : ''}
                </option>
              ))}
            </select>
            {qOpen && (
              <button className="btn small" onClick={() => act('close')}>
                ⏹ Stop answers now
              </button>
            )}
            <button className="btn small" onClick={() => act('lobby')}>
              Show join screen
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm('End the game and show the final results?')) void act('end');
              }}
            >
              End game
            </button>
          </div>

          {q ? (
            <div className="current-q">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="muted small">
                    Question {q.index + 1}/{q.total} · {KIND_LABELS[q.kind]} · {q.points} pts
                  </div>
                  <h2 style={{ margin: '4px 0' }}>{q.text}</h2>
                </div>
                <div className="timer-badge">{qOpen ? remaining : '—'}</div>
              </div>
              <div className="answers-live">
                {q.answers.map((a, i) => (
                  <div key={i} className={`answer-live ${extra.correct === i ? 'correct' : ''}`}>
                    <span className="answer-badge" style={{ background: answerColor(i) }}>
                      <AnswerIcon index={i} size={18} />
                    </span>
                    <span className="answer-text">
                      {a} {extra.correct === i && <strong className="right-mark">✔ right</strong>}
                    </span>
                    <span className="bar">
                      <span style={{ width: `${(counts[i] / maxCount) * 100}%`, background: answerColor(i) }} />
                    </span>
                    <span className="count">{counts[i] ?? 0}</span>
                  </div>
                ))}
              </div>
              <div className="row small">
                <span>
                  Answered: <strong>{state.answeredCount}</strong> / {online}
                </span>
                {state.reveal?.firstCorrect && (
                  <span>
                    ⚡ First right: <strong>{state.reveal.firstCorrect.name}</strong> ({(state.reveal.firstCorrect.ms / 1000).toFixed(1)}s)
                  </span>
                )}
                {q.media.source !== 'none' && (
                  <>
                    <span style={{ flex: 1 }} />
                    <button className="btn small" onClick={() => act('media', { mode: 'replay' })}>
                      🔁 Replay clip
                    </button>
                    <button className="btn small" onClick={() => act('media', { mode: 'stop' })}>
                      ⏹ Stop music
                    </button>
                  </>
                )}
              </div>
              {extra.answers.length > 0 && (
                <details className="answer-feed">
                  <summary>Who answered what ({extra.answers.length})</summary>
                  <ol>
                    {extra.answers.map((a) => (
                      <li key={a.playerId}>
                        <span className="answer-badge tiny" style={{ background: answerColor(a.choice) }}>
                          <AnswerIcon index={a.choice} size={12} />
                        </span>{' '}
                        {a.name} <span className="muted">{(a.ms / 1000).toFixed(1)}s</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ) : (
            <div className="current-q muted">
              No question running. Players join at <strong>{joinUrl}</strong>
              <img className="mini-qr" src={qrUrl(joinUrl)} alt="QR code" />
            </div>
          )}

          <div className="announce">
            <strong>Message on the big screen</strong>
            <div className="row nowrap">
              <input value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder="e.g. BINGO for card A-012! 🎉" />
              <button className="btn" onClick={() => act('announce', { text: announce })} disabled={!announce.trim()}>
                Show
              </button>
              <button className="btn" onClick={() => act('announce', { text: '' })} disabled={!state.announcement}>
                Hide
              </button>
            </div>
            <div className="row small">
              {['🎉 BINGO! Please wait while we check the card', '☕ Short break, back in 10 minutes', '🔁 Line! Keep playing for a full house'].map((t) => (
                <button key={t} className="btn small" onClick={() => act('announce', { text: t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- bingo ---------- */}
        <section className="panel bingo-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Bingo · {state.drawn.length} drawn</h3>
            {state.lastNumber != null && (
              <span className="ball" style={{ width: 56, height: 56, fontSize: 24 }}>
                {bingoLetter(state.lastNumber, state.settings.bingoMax)}
                {state.lastNumber}
              </span>
            )}
          </div>
          <div className={`board board-${state.settings.bingoMax}`}>
            {Array.from({ length: state.settings.bingoMax }, (_, i) => i + 1).map((n) => (
              <span key={n} className={`cell ${state.drawn.includes(n) ? 'on' : ''} ${n === state.lastNumber ? 'last' : ''}`}>
                {n}
              </span>
            ))}
          </div>
          <div className="row nowrap small">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Number from a ball machine"
              inputMode="numeric"
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && manual) {
                  const r = await act('draw', { number: manual });
                  if (r.ok) setManual('');
                }
              }}
            />
            <button
              className="btn small"
              disabled={!manual}
              onClick={async () => {
                const r = await act('draw', { number: manual });
                if (r.ok) setManual('');
              }}
            >
              Add
            </button>
            <button className="btn small" onClick={() => act('undoDraw')} disabled={!state.drawn.length}>
              Undo last
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm('Clear all drawn numbers and start a new bingo round?')) void act('resetBingo');
              }}
            >
              New round
            </button>
          </div>
          {state.settings.bingoMax === 75 && (
            <div className="card-check">
              <strong>Check a printed card</strong>
              <div className="row nowrap">
                <input value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="Card number, e.g. A-012" onKeyDown={(e) => e.key === 'Enter' && checkCard()} />
                <button className="btn" onClick={checkCard} disabled={!cardId.trim()}>
                  Check
                </button>
              </div>
              {cardErr && <p className="error small">{cardErr}</p>}
              {card && (
                <div className="card-result">
                  <BingoCardView grid={card.grid} marked={card.marked} id={card.id} compact />
                  <div>
                    {card.fullHouse ? (
                      <p className="good big-text">FULL HOUSE ✔</p>
                    ) : card.lines.length ? (
                      <p className="good big-text">LINE ✔</p>
                    ) : (
                      <p className="bad big-text">No bingo yet ✗</p>
                    )}
                    {card.lines.length > 0 && <p className="small">{card.lines.join(', ')}</p>}
                    <p className="muted small">{card.missing} numbers still missing</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ---------- players & groups ---------- */}
        <section className="panel people">
          <h3>Groups ({state.groups.length})</h3>
          <ol className="rank-list">
            {state.groups.map((g) => (
              <li key={g.id}>
                <span className="name">{g.name}</span>
                <span className="muted small">{g.members} 👤</span>
                <strong>{g.score}</strong>
              </li>
            ))}
            {!state.groups.length && <li className="muted">No groups yet</li>}
          </ol>
          <h3>Players ({state.players.length})</h3>
          <ol className="rank-list players">
            {state.players.map((p) => (
              <li key={p.id}>
                <span className={`dot ${p.connected ? 'on' : ''}`} title={p.connected ? 'Online' : 'Offline'} />
                <span className="name">
                  {p.name}
                  {p.groupId && <span className="muted small"> · {groupName(p.groupId)}</span>}
                </span>
                <strong>{p.score}</strong>
                <span className="player-tools">
                  <button className="btn small" title="Give 10 points" onClick={() => act('adjust', { playerId: p.id, delta: 10 })}>
                    +10
                  </button>
                  <button className="btn small" title="Take 10 points" onClick={() => act('adjust', { playerId: p.id, delta: -10 })}>
                    −10
                  </button>
                  <button
                    className="btn small danger"
                    title="Remove player"
                    onClick={() => {
                      if (confirm(`Remove ${p.name} from the game?`)) void act('kick', { playerId: p.id });
                    }}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
            {!state.players.length && <li className="muted">Nobody has joined yet</li>}
          </ol>
          <p className="muted small">
            Shortcuts: <kbd>D</kbd> draw · <kbd>S</kbd> start question · <kbd>R</kbd> show answer · <kbd>L</kbd> leaderboard
          </p>
          <p className="muted small">Answer colours: {ANSWER_STYLES.map((s) => s.name).join(', ')}</p>
        </section>
      </div>
    </div>
  );
}
