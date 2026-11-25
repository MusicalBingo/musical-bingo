import { useEffect, useRef, useState } from 'react';
import { ANSWER_STYLES, KIND_LABELS } from '../../../shared/types.ts';
import { bingoLetter } from '../../../shared/util.ts';
import type { CardCheck } from '../../../shared/bingo.ts';
import { AnswerIcon, answerColor } from '../common/Shape.tsx';
import { emit, joinBaseUrl, qrUrl, serverNow, useConnection, useGameState, useTicker } from '../common/net.ts';
import { AuthError, api, getToken, go } from './api.ts';
import { BingoCardView } from './Cards.tsx';

type DrawMode = 'machine' | 'random';
const MODE_KEY = 'mb-draw-mode';

function savedMode(): DrawMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'random' ? 'random' : 'machine';
  } catch {
    return 'machine';
  }
}

/** Reads what the presenter typed for a ball: "12", "B12", "b 12", "N-35". Returns the number or an error. */
function parseBall(raw: string, max: number): number | string {
  const m = raw.trim().toUpperCase().match(/^([BINGO])?\s*-?\s*(\d{1,2})$/);
  if (!m) return 'Type the number on the ball, e.g. 12 or B12.';
  const n = Number(m[2]);
  if (n < 1 || n > max) return `Numbers go from 1 to ${max}.`;
  const letter = bingoLetter(n, max);
  if (m[1] && max === 75 && m[1] !== letter) return `${m[1]}${n} doesn't exist: ${n} is in the ${letter} column. Check the ball.`;
  return n;
}

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
  const [mode, setModeState] = useState<DrawMode>(savedMode);
  const callInput = useRef<HTMLInputElement>(null);

  const setMode = (m: DrawMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };

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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      // the ball box only takes numbers and B I N G O, so the other shortcuts keep working while it has the focus
      const inCallBox = target === callInput.current;
      if (!inCallBox && target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      const shortcut = (f: () => void) => {
        e.preventDefault();
        f();
      };
      if (k === 'd') {
        if (mode === 'random') shortcut(() => void act('draw'));
        else shortcut(() => callInput.current?.select());
      } else if (k === 's') shortcut(() => void act('start', { index: nextIndex ?? undefined }));
      else if (k === 'r') shortcut(() => void act('reveal'));
      else if (k === 'l') shortcut(() => void act('leaderboard'));
      else if (mode === 'machine' && !inCallBox && /^[0-9bingo]$/.test(k)) callInput.current?.focus(); // start typing a ball anywhere
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextIndex, mode]);

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

  const max = state.settings.bingoMax;
  const ballName = (n: number) => `${bingoLetter(n, max)}${n}`;
  const callBall = async (raw: string) => {
    const n = parseBall(raw, max);
    if (typeof n === 'string') return setErr(n);
    if (state.drawn.includes(n)) return setErr(`${ballName(n)} has already been called.`);
    const r = await act('draw', { number: n });
    if (r.ok) setManual('');
  };

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
            {mode === 'random' ? (
              <button className={`btn big ${primary === 'draw' ? 'primary' : ''}`} onClick={() => act('draw')} title="Shortcut: D">
                🎲 Draw number
              </button>
            ) : (
              <form
                className="call-box"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (manual.trim()) void callBall(manual);
                }}
              >
                <input
                  ref={callInput}
                  value={manual}
                  onChange={(e) => setManual(e.target.value.replace(/[^0-9bingoBINGO\s-]/g, ''))}
                  placeholder="Ball no."
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Number on the ball"
                  title="Type the number on the ball and press Enter, or click it on the board"
                />
                <button className={`btn big ${primary === 'draw' ? 'primary' : ''}`} disabled={!manual.trim()} title="Enter">
                  🎱 Call
                </button>
              </form>
            )}
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
          <div className="row small">
            <span className="muted">Numbers:</span>
            <span className="mode-switch" role="group" aria-label="Where the numbers come from">
              <button className={mode === 'machine' ? 'on' : ''} onClick={() => setMode('machine')} title="You draw the balls; type or click each number">
                🎱 Ball machine
              </button>
              <button className={mode === 'random' ? 'on' : ''} onClick={() => setMode('random')} title="The app picks a random number">
                🎲 Random
              </button>
            </span>
          </div>
          <div className={`board board-${max}`}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
              const on = state.drawn.includes(n);
              const cls = `cell ${on ? 'on' : ''} ${n === state.lastNumber ? 'last' : ''}`;
              return mode === 'machine' ? (
                <button key={n} className={cls} disabled={on} onClick={() => callBall(String(n))} title={on ? `${ballName(n)} called` : `Call ${ballName(n)}`}>
                  {n}
                </button>
              ) : (
                <span key={n} className={cls}>
                  {n}
                </span>
              );
            })}
          </div>
          {mode === 'machine' && (
            <p className="muted small" style={{ margin: 0 }}>
              Type each ball in the box on the left and press Enter, or click it here.
            </p>
          )}
          <div className="row nowrap small">
            <button className="btn small" onClick={() => act('undoDraw')} disabled={!state.drawn.length} title="Take back the last number (e.g. a typo)">
              ↶ Undo {state.lastNumber != null ? ballName(state.lastNumber) : 'last'}
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
            Shortcuts: <kbd>D</kbd> {mode === 'random' ? 'draw' : 'type a ball'} · <kbd>S</kbd> start question · <kbd>R</kbd> show answer · <kbd>L</kbd> leaderboard
          </p>
          <p className="muted small">Answer colours: {ANSWER_STYLES.map((s) => s.name).join(', ')}</p>
        </section>
      </div>
    </div>
  );
}
