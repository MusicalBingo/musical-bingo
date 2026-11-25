import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../common/base.css';
import './display.css';
import { ANSWER_STYLES, KIND_LABELS, type GameSummary, type PublicState } from '../../../shared/types.ts';
import { bingoLetter } from '../../../shared/util.ts';
import { AnswerIcon, answerColor } from '../common/Shape.tsx';
import { ClipPlayer, ImageReveal } from '../common/media.tsx';
import { emit, getSocket, joinBaseUrl, qrUrl, serverNow, useConnection, useGameState, useTicker } from '../common/net.ts';

function App() {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') || '');
  const [started, setStarted] = useState(false);

  const choose = (c: string) => {
    const url = new URL(location.href);
    if (c) url.searchParams.set('code', c);
    else url.searchParams.delete('code');
    history.replaceState(null, '', url);
    setCode(c);
  };

  if (!code) return <Picker onPick={choose} />;
  if (!started)
    return (
      <div className="start-screen" onClick={() => setStarted(true)}>
        <div className="start-box">
          <div className="logo-big">🎵</div>
          <h1>Musical Bingo</h1>
          <p>Game {code}</p>
          <button className="btn primary big">▶ Start the big screen</button>
          <p className="muted">One click is needed so the browser allows music to play. Press F11 for full screen.</p>
        </div>
      </div>
    );
  return <Stage code={code} onLost={() => choose('')} />;
}

function Picker({ onPick }: { onPick: (c: string) => void }) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [input, setInput] = useState('');
  useEffect(() => {
    const load = () => fetch('/api/games').then((r) => r.json()).then(setGames).catch(() => {});
    void load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);
  const live = games.filter((g) => g.phase !== 'ended');
  return (
    <div className="start-screen">
      <div className="start-box">
        <h1>📺 Big screen</h1>
        <p className="muted">Pick the game to show on this screen.</p>
        <div className="game-pick">
          {live.map((g) => (
            <button key={g.code} className="btn big" onClick={() => onPick(g.code)}>
              {g.code} · {g.title}
            </button>
          ))}
          {!live.length && <p className="muted">No game is running. Start one in the presenter app; it will appear here.</p>}
        </div>
        <form
          className="row nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (input) onPick(input);
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))} placeholder="…or type the game code" />
          <button className="btn">Open</button>
        </form>
      </div>
    </div>
  );
}

function Stage({ code, onLost }: { code: string; onLost: () => void }) {
  const [msg] = useGameState();
  const [joinBase, setJoinBase] = useState('');
  const connected = useConnection(async () => {
    const r = await emit('display:attach', { code });
    if (!r.ok) onLost();
  });

  useEffect(() => {
    void joinBaseUrl().then(setJoinBase);
    const s = getSocket();
    s.on('gameClosed', onLost);
    return () => {
      s.off('gameClosed', onLost);
    };
  }, []);

  const state = msg?.state;
  if (!state) return <div className="stage center muted">{connected ? 'Loading…' : 'Connecting to the server…'}</div>;
  const joinUrl = `${joinBase}/play?code=${state.code}`;

  let content: React.ReactNode;
  switch (state.phase) {
    case 'lobby':
      content = <Lobby state={state} joinUrl={joinUrl} />;
      break;
    case 'number':
      content = <NumberDraw state={state} />;
      break;
    case 'question':
    case 'reveal':
      content = state.question ? <QuestionView state={state} /> : null;
      break;
    case 'leaderboard':
      content = <Leaderboard state={state} />;
      break;
    case 'ended':
      content = <Final state={state} />;
      break;
  }

  return (
    <div className="stage">
      {!connected && <div className="offline">Connection to the server lost, reconnecting…</div>}
      {content}
      {state.phase !== 'lobby' && (
        <div className="corner">
          {state.lastNumber != null && (
            <span className="ball corner-ball">
              {bingoLetter(state.lastNumber, state.settings.bingoMax)}
              {state.lastNumber}
            </span>
          )}
          <span className="corner-join">
            Join: <strong>{joinUrl.replace(/^https?:\/\//, '')}</strong>
          </span>
        </div>
      )}
      {state.announcement && <Announcement key={state.announcement.at} text={state.announcement.text} />}
    </div>
  );
}

function Announcement({ text }: { text: string }) {
  return (
    <div className="announcement">
      <div className="announcement-box">{text}</div>
    </div>
  );
}

function Lobby({ state, joinUrl }: { state: PublicState; joinUrl: string }) {
  const solo = state.players.filter((p) => !p.groupId);
  return (
    <div className="lobby">
      <div className="lobby-join">
        <h1 className="title">🎵 {state.title}</h1>
        <img className="qr" src={qrUrl(joinUrl)} alt="QR code to join" />
        <p className="join-url">{joinUrl.replace(/^https?:\/\//, '')}</p>
        <p className="join-code">
          Game code <strong>{state.code}</strong>
        </p>
        <p className="muted">
          {state.settings.playAs === 'groups'
            ? 'Scan with your phone camera, enter your name, then join or create the group for your table.'
            : 'Scan with your phone camera and enter your name.'}
        </p>
      </div>
      <div className="lobby-people">
        <h2>
          {state.players.length} player{state.players.length === 1 ? '' : 's'} joined
        </h2>
        <div className="group-cloud">
          {state.groups.map((g) => (
            <div key={g.id} className="group-chip">
              <strong>👥 {g.name}</strong>
              <span>{state.players.filter((p) => p.groupId === g.id).map((p) => p.name).join(', ')}</span>
            </div>
          ))}
        </div>
        <div className="player-cloud">
          {solo.map((p) => (
            <span key={p.id} className="player-chip">
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function NumberDraw({ state }: { state: PublicState }) {
  const n = state.lastNumber;
  return (
    <div className="number-draw">
      <p className="muted big-label">Number {state.drawn.length}</p>
      {n != null && (
        <div key={n} className="ball mega-ball">
          <small>{bingoLetter(n, state.settings.bingoMax)}</small>
          {n}
        </div>
      )}
      <Board state={state} />
    </div>
  );
}

function Board({ state }: { state: PublicState }) {
  const max = state.settings.bingoMax;
  const cols = max > 60 ? 15 : 10;
  // keep the cells the same size whatever the number of columns
  return (
    <div className="big-board" style={max === 75 ? undefined : { width: `min(100%, ${cols * 8}vh)` }}>
      {max === 75 &&
        'BINGO'.split('').map((l, r) => (
          <div key={l} className="board-row">
            <span className="board-letter">{l}</span>
            {Array.from({ length: 15 }, (_, i) => r * 15 + i + 1).map((v) => (
              <span key={v} className={`bcell ${state.drawn.includes(v) ? 'on' : ''} ${v === state.lastNumber ? 'last' : ''}`}>
                {v}
              </span>
            ))}
          </div>
        ))}
      {max !== 75 && (
        <div className="board-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
            <span key={v} className={`bcell ${state.drawn.includes(v) ? 'on' : ''} ${v === state.lastNumber ? 'last' : ''}`}>
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionView({ state }: { state: PublicState }) {
  const q = state.question!;
  const rv = state.phase === 'reveal' ? state.reveal : null;
  const open = state.phase === 'question' && !q.closed;
  const [playing, setPlaying] = useState(false);
  useTicker(open, 250);

  const now = serverNow();
  const left = Math.max(0, q.endsAt - now);
  const progress = (now - q.startedAt) / (q.timeLimit * 1000 * 0.9);
  const isYouTube = q.media.source === 'youtube';
  const videoVisible = isYouTube && (q.media.showVideo || !!rv);
  const online = state.players.filter((p) => p.connected).length;
  const maxCount = Math.max(1, ...(rv?.counts ?? [1]));

  return (
    <div className="question">
      <header className="q-head">
        <span className="q-kind">
          {state.lastNumber != null && (
            <>
              <span className="ball q-ball">
                {bingoLetter(state.lastNumber, state.settings.bingoMax)}
                {state.lastNumber}
              </span>{' '}
            </>
          )}
          {KIND_LABELS[q.kind]} · {q.index + 1}/{q.total}
        </span>
        <h1 className="q-text">{q.text}</h1>
      </header>

      <div className="q-middle">
        <div className="q-side">
          {open ? (
            <div className="countdown" style={{ ['--p' as any]: `${(left / (q.timeLimit * 1000)) * 360}deg` }}>
              <span>{Math.ceil(left / 1000)}</span>
            </div>
          ) : (
            <div className="countdown done">
              <span>{rv ? '✔' : '⏰'}</span>
            </div>
          )}
        </div>

        <div className="q-media">
          {q.media.source !== 'none' && (
            <div className={`video-slot ${videoVisible ? 'show' : ''}`}>
              <ClipPlayer
                media={q.media}
                playKey={`${q.id}:${q.startedAt}:${state.mediaNonce}`}
                stopped={state.mediaStopped}
                showVideo={videoVisible}
                onPlayingChange={setPlaying}
              />
            </div>
          )}
          {!videoVisible && q.image && <ImageReveal image={q.image} progress={progress} full={!!rv} seed={q.id} />}
          {!videoVisible && !q.image && q.media.source !== 'none' && (
            <div className="listen">
              <div className={`eq big-eq ${playing ? 'on' : ''}`}>
                {Array.from({ length: 9 }, (_, i) => (
                  <i key={i} style={{ animationDelay: `${-i * 0.13}s` }} />
                ))}
              </div>
              <p>{playing ? 'Listen…' : rv ? '' : '🎧'}</p>
            </div>
          )}
        </div>

        <div className="q-side">
          <div className="answered">
            <strong>{state.answeredCount}</strong>
            <span>of {online} answered</span>
          </div>
        </div>
      </div>

      {rv && (
        <div className="first-banner">
          {rv.firstCorrect ? (
            <>
              ⚡ Fastest right answer: <strong>{rv.firstCorrect.name}</strong>
              {rv.firstCorrect.groupName && <> ({rv.firstCorrect.groupName})</>} in {(rv.firstCorrect.ms / 1000).toFixed(1)}s · +
              {state.settings.firstBonus} bonus
            </>
          ) : (
            <>Nobody got this one!</>
          )}
        </div>
      )}

      <div className={`answer-grid n${q.answers.length}`}>
        {q.answers.map((a, i) => {
          const isRight = rv?.correct === i;
          return (
            <div key={i} className={`answer-tile ${rv ? (isRight ? 'right' : 'wrong') : ''}`} style={{ background: answerColor(i) }}>
              <AnswerIcon index={i} size={56} />
              <span className="answer-label">{a}</span>
              {rv && (
                <span className="answer-count">
                  <span className="count-bar" style={{ width: `${(rv.counts[i] / maxCount) * 4}em` }} />
                  <b>{rv.counts[i]}</b>
                  {isRight && ' ✔'}
                </span>
              )}
              <span className="sr-only">{ANSWER_STYLES[i].name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({ state }: { state: PublicState }) {
  const groupName = (id: string | null) => state.groups.find((g) => g.id === id)?.name;
  return (
    <div className="leaderboard">
      <h1 className="title">🏆 Leaderboard</h1>
      <div className="lb-cols">
        <div className="lb-col">
          <h2>Players</h2>
          <ol>
            {state.players.slice(0, 10).map((p, i) => (
              <li key={p.id} style={{ animationDelay: `${i * 0.06}s` }}>
                <span className="rank">{i + 1}</span>
                <span className="lb-name">
                  {p.name}
                  {p.groupId && <small> · {groupName(p.groupId)}</small>}
                </span>
                <strong>{p.score}</strong>
              </li>
            ))}
          </ol>
        </div>
        {state.groups.length > 0 && (
          <div className="lb-col" style={{ order: -1 }}>
            <h2>Groups{state.settings.groupScoring === 'average' ? ' (average per member)' : ''}</h2>
            <ol>
              {state.groups.slice(0, 10).map((g, i) => (
                <li key={g.id} style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="rank">{i + 1}</span>
                  <span className="lb-name">
                    {g.name} <small>· {g.members} 👤</small>
                  </span>
                  <strong>{g.score}</strong>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function Final({ state }: { state: PublicState }) {
  // a group game puts the groups on the podium and lists the best players below; an individual game the other way round
  const byGroup = state.groups.length > 0;
  const top = (byGroup ? state.groups : state.players).slice(0, 3).map((x) => ({ id: x.id, name: x.name, score: x.score }));
  const others = (byGroup ? state.players : []).slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  return (
    <div className="final">
      <h1 className="title">🎉 Final results</h1>
      <div className="podium">
        {order.map((i) => (
          <div key={top[i].id} className={`podium-step p${i + 1}`}>
            <span className="podium-name">{byGroup ? `👥 ${top[i].name}` : top[i].name}</span>
            <span className="podium-score">{top[i].score} pts</span>
            <div className="podium-block">{['🥇', '🥈', '🥉'][i]}</div>
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <div className="final-groups">
          <h2>Best players</h2>
          {others.map((p, i) => (
            <div key={p.id} className="final-group">
              {['🥇', '🥈', '🥉'][i]} <strong>{p.name}</strong> · {p.score} pts
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
