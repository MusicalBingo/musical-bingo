import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../common/base.css';
import './play.css';
import { ANSWER_STYLES, KIND_LABELS, type PlayerYou, type PublicState } from '../../../shared/types.ts';
import { bingoLetter } from '../../../shared/util.ts';
import { AnswerIcon, answerColor } from '../common/Shape.tsx';
import { emit, getSocket, serverNow, storage, store, useConnection, useGameState, useTicker } from '../common/net.ts';
import { ThemeDecor, useTheme } from '../common/theme.tsx';
import { keepAwakeStatus, setKeepAwake } from '../common/keepAwake.ts';

interface Session {
  code: string;
  playerId: string;
  token: string;
  name: string;
}
const SESSION_KEY = 'mb.player';
const NAME_KEY = 'mb.name';

function App() {
  const urlCode = new URLSearchParams(location.search).get('code') || '';
  const [session, setSession] = useState<Session | null>(() => {
    const s = storage<Session | null>(SESSION_KEY, null);
    return s && (!urlCode || s.code === urlCode) ? s : null;
  });
  const [msg, setMsg] = useGameState();
  const [notice, setNotice] = useState('');
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const connected = useConnection(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const r = await emit('player:join', { code: s.code, playerId: s.playerId, token: s.token, name: s.name });
    if (!r.ok) {
      if (/No game|ended/i.test(r.error)) {
        leave(r.error);
      } else if (/name is taken/i.test(r.error)) {
        // our old player was removed and someone else has the name now
        leave('You were removed from the game. Please join again.');
      } else setNotice(r.error);
    } else if (r.playerId !== s.playerId) {
      const ns = { ...s, playerId: r.playerId, token: r.token };
      store(SESSION_KEY, ns);
      setSession(ns);
    }
  });

  const leave = (why = '') => {
    store(SESSION_KEY, null);
    setSession(null);
    setMsg(null);
    setNotice(why);
  };

  useEffect(() => {
    const s = getSocket();
    const kicked = () => leave('The presenter removed you from the game.');
    const closed = () => leave('The game has been closed. Thanks for playing!');
    s.on('kicked', kicked);
    s.on('gameClosed', closed);
    return () => {
      s.off('kicked', kicked);
      s.off('gameClosed', closed);
    };
  }, []);

  // Keep the screen on until the game is over, closed or the player removed (also on the join screen: the first tap there starts it).
  const ended = msg?.state.phase === 'ended' || (!session && /closed|removed/i.test(notice));
  useEffect(() => setKeepAwake(!ended), [ended]);
  useTheme(msg?.state.settings.theme);

  if (!session)
    return (
      <JoinScreen
        initialCode={urlCode}
        notice={notice}
        onJoined={(s) => {
          store(SESSION_KEY, s);
          store(NAME_KEY, s.name);
          setNotice('');
          setSession(s);
        }}
      />
    );

  const state = msg?.state;
  const you = msg?.you;
  return (
    <div className="app">
      {state && <ThemeDecor id={state.settings.theme} count={12} faint />}
      {!connected && <div className="offline">Connection lost, reconnecting…</div>}
      {state && you ? (
        <GameScreen state={state} you={you} onLeave={() => {
          if (confirm('Leave the game? Your points stay with your name, but you will need to join again.')) {
            getSocket().emit('player:leave');
            leave();
          }
        }} />
      ) : (
        <div className="center muted">{notice || 'Joining the game…'}</div>
      )}
    </div>
  );
}

function JoinScreen({ initialCode, notice, onJoined }: { initialCode: string; notice: string; onJoined: (s: Session) => void }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(() => storage<string>(NAME_KEY, ''));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = useConnection();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await emit('player:join', { code: code.trim(), name: name.trim() });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onJoined({ code: code.trim(), playerId: r.playerId, token: r.token, name: r.name });
  };

  return (
    <div className="app join">
      <form onSubmit={submit} className="join-form">
        <div className="logo">🎵</div>
        <h1>Musical Bingo</h1>
        {notice && <p className="notice">{notice}</p>}
        <label>
          <span>Game code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="From the big screen"
            className="code-input"
          />
        </label>
        <label>
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="What should we call you?" autoComplete="nickname" maxLength={24} />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={busy || !code || !name.trim() || !connected}>
          {connected ? (busy ? 'Joining…' : "Let's play!") : 'Connecting…'}
        </button>
      </form>
    </div>
  );
}

function GameScreen({ state, you, onLeave }: { state: PublicState; you: PlayerYou; onLeave: () => void }) {
  const groupsOn = state.settings.playAs === 'groups';
  const myGroup = state.groups.find((g) => g.id === you.groupId) ?? null;
  const groupRank = myGroup ? state.groups.findIndex((g) => g.id === myGroup.id) + 1 : 0;
  const q = state.question;
  const lastQ = useRef<string | null>(null);

  useEffect(() => {
    if (state.phase === 'question' && q && lastQ.current !== `${q.id}:${q.startedAt}`) {
      lastQ.current = `${q.id}:${q.startedAt}`;
      navigator.vibrate?.(150);
    }
  }, [state.phase, q?.id, q?.startedAt]);

  let body: React.ReactNode;
  if (state.phase === 'question' && q) body = <QuestionPad state={state} you={you} />;
  else if (state.phase === 'reveal' && q) body = <RevealView state={state} you={you} />;
  else if (state.phase === 'ended') body = <FinalView state={state} you={you} groupRank={groupRank} />;
  else
    body = (
      <>
        {state.phase === 'number' && state.lastNumber != null && (
          <div className="drawn">
            <span className="muted">Number drawn</span>
            <span className="ball drawn-ball">
              <small>{bingoLetter(state.lastNumber, state.settings.bingoMax)}</small>
              {state.lastNumber}
            </span>
            <span>Mark it on your card! A music question is coming…</span>
          </div>
        )}
        {state.phase === 'lobby' && (
          <div className="waiting">
            <div className="eq on">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <p>{groupsOn ? "You're in! Join your table's group below, then watch the big screen." : "You're in! Watch the big screen, the game starts soon."}</p>
          </div>
        )}
        {state.phase === 'leaderboard' && (
          <div className="waiting">
            <p className="big">
              You're <strong>#{you.rank}</strong> of {state.players.length}
            </p>
            {myGroup && (
              <p>
                {myGroup.name} is <strong>#{groupRank}</strong> of {state.groups.length}
              </p>
            )}
          </div>
        )}
        {groupsOn && <GroupBox state={state} you={you} />}
      </>
    );

  return (
    <>
      <header className="me">
        <div className="me-name">
          <strong>{you.name}</strong>
          {groupsOn && <span className="muted small">{myGroup ? `👥 ${myGroup.name}` : 'No group yet'}</span>}
        </div>
        <div className="me-score">
          <strong>{you.score}</strong>
          <span className="muted small">pts · #{you.rank}</span>
        </div>
      </header>
      <main className="body">{body}</main>
      {(state.phase === 'lobby' || state.phase === 'ended') && (
        <footer className="foot">
          <button className="link" onClick={onLeave}>
            Leave game
          </button>
        </footer>
      )}
    </>
  );
}

function GroupBox({ state, you }: { state: PublicState; you: PlayerYou }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(!you.groupId);
  const mine = state.groups.find((g) => g.id === you.groupId);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await emit('player:createGroup', { name });
    if (!r.ok) setErr(r.error);
    else {
      setName('');
      setErr('');
      setOpen(false);
    }
  };
  const join = async (groupId: string | null) => {
    const r = await emit('player:joinGroup', { groupId });
    if (!r.ok) setErr(r.error);
    else setOpen(groupId == null);
  };

  if (mine && !open)
    return (
      <div className="group-box">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted small">Your group</div>
            <strong className="group-name">👥 {mine.name}</strong>
            <div className="muted small">
              {mine.members} member{mine.members === 1 ? '' : 's'} · {mine.score} pts
            </div>
          </div>
          <button className="btn small" onClick={() => setOpen(true)}>
            Change
          </button>
        </div>
      </div>
    );

  return (
    <div className="group-box">
      <strong>Your group</strong>
      <p className="muted small">Tap your table's group, or create it if you're the first one there.</p>
      <form onSubmit={create} className="row nowrap">
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="New group name" maxLength={24} />
        <button className="btn primary" disabled={!name.trim()}>
          Create
        </button>
      </form>
      {err && <p className="error small">{err}</p>}
      {state.groups.length > 0 && (
        <div className="group-list">
          {state.groups.map((g) => (
            <button key={g.id} className={`group-item ${g.id === you.groupId ? 'mine' : ''}`} onClick={() => join(g.id)}>
              <span>👥 {g.name}</span>
              <span className="muted small">{g.members} 👤</span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        {mine && (
          <button className="btn small" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function TimerBar({ startedAt, endsAt }: { startedAt: number; endsAt: number }) {
  useTicker(true, 200);
  const total = endsAt - startedAt;
  const left = Math.max(0, endsAt - serverNow());
  return (
    <div className="timer">
      <div className="timer-fill" style={{ width: `${(left / total) * 100}%` }} />
      <span>{Math.ceil(left / 1000)}s</span>
    </div>
  );
}

function QuestionPad({ state, you }: { state: PublicState; you: PlayerYou }) {
  const q = state.question!;
  const [pending, setPending] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const chosen = you.answer ?? pending;

  useEffect(() => {
    setPending(null);
    setErr('');
  }, [q.id, q.startedAt]);

  const answer = async (i: number) => {
    if (chosen != null || q.closed) return;
    setPending(i);
    navigator.vibrate?.(40);
    const r = await emit('player:answer', { choice: i });
    if (!r.ok) {
      setErr(r.error);
      if (!/already/.test(r.error)) setPending(null);
    }
  };

  if (chosen != null) {
    const s = ANSWER_STYLES[chosen];
    return (
      <div className="locked">
        <div className="locked-shape" style={{ background: s.color }}>
          <AnswerIcon index={chosen} size={96} />
        </div>
        <p className="big">
          You chose <strong>{s.name}</strong>
        </p>
        {state.settings.answersOnPhones && <p className="muted">{q.answers[chosen]}</p>}
        <p className="muted small">Waiting for the others… {state.answeredCount} answered</p>
        {!q.closed && <TimerBar startedAt={q.startedAt} endsAt={q.endsAt} />}
      </div>
    );
  }

  if (q.closed)
    return (
      <div className="locked">
        <p className="big">⏰ Time's up!</p>
        <p className="muted">You didn't answer this one.</p>
      </div>
    );

  return (
    <div className="pad-wrap">
      <div className="pad-head">
        <span className="muted small">
          {KIND_LABELS[q.kind]} · {q.index + 1}/{q.total}
        </span>
        <TimerBar startedAt={q.startedAt} endsAt={q.endsAt} />
      </div>
      <div className={`pad pad-${q.answers.length}`}>
        {q.answers.map((a, i) => (
          <button key={i} className="pad-btn" style={{ background: answerColor(i) }} onClick={() => answer(i)} aria-label={`${ANSWER_STYLES[i].name}: ${a}`}>
            <AnswerIcon index={i} size={state.settings.answersOnPhones ? 44 : 84} />
            {state.settings.answersOnPhones && <span className="pad-text">{a}</span>}
          </button>
        ))}
      </div>
      {err && <p className="error center-text">{err}</p>}
    </div>
  );
}

function RevealView({ state, you }: { state: PublicState; you: PlayerYou }) {
  const q = state.question!;
  const rv = state.reveal;
  const res = you.result;
  if (!rv)
    return (
      <div className="locked">
        <p className="big">⏰ Time's up!</p>
        <p className="muted">The answer is coming…</p>
      </div>
    );
  const s = ANSWER_STYLES[rv.correct];
  const answered = you.answer != null;
  return (
    <div className={`result ${res?.correct ? 'win' : 'lose'}`}>
      <div className="result-icon">{res?.correct ? '🎉' : answered ? '😬' : '⏰'}</div>
      <p className="result-title">{res?.correct ? 'Correct!' : answered ? 'Not this time' : 'No answer'}</p>
      {res?.correct && (
        <p className="result-points">
          +{res.points}
          {res.first && <span className="bonus">⚡ fastest! +{state.settings.firstBonus} bonus</span>}
        </p>
      )}
      <div className="right-answer">
        <span className="answer-chip" style={{ background: s.color }}>
          <AnswerIcon index={rv.correct} size={28} />
        </span>
        <span>{q.answers[rv.correct]}</span>
      </div>
      {rv.firstCorrect && !res?.first && <p className="muted small">⚡ Fastest: {rv.firstCorrect.name}</p>}
      <p className="muted">
        You're #{you.rank} with {you.score} points
      </p>
    </div>
  );
}

function FinalView({ state, you, groupRank }: { state: PublicState; you: PlayerYou; groupRank: number }) {
  return (
    <div className="result win">
      <div className="result-icon">{you.rank === 1 ? '🏆' : you.rank <= 3 ? '🥳' : '🎶'}</div>
      <p className="result-title">Game over!</p>
      <p className="big">
        You finished <strong>#{you.rank}</strong> of {state.players.length}
      </p>
      <p className="result-points">{you.score} points</p>
      {groupRank > 0 && (
        <p>
          Your group finished <strong>#{groupRank}</strong> of {state.groups.length}
        </p>
      )}
      <p className="muted">Thanks for playing Musical Bingo!</p>
    </div>
  );
}

(window as any).mbKeepAwake = keepAwakeStatus; // lets you check it from the browser console
createRoot(document.getElementById('root')!).render(<App />);
