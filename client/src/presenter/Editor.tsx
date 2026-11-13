import { useEffect, useRef, useState } from 'react';
import { ANSWER_STYLES, KIND_LABELS, type Question, type QuestionKind, type Quiz, type QuizSettings } from '../../../shared/types.ts';
import { parseYouTube } from '../../../shared/util.ts';
import { AnswerIcon, answerColor } from '../common/Shape.tsx';
import { ClipPlayer, ImageReveal } from '../common/media.tsx';
import { AuthError, api, go, uploadFile } from './api.ts';
import { newQuestion, uid } from './templates.ts';

const KIND_ICON: Record<QuestionKind, string> = { song: '🎵', singer: '🎤', band: '🖼', other: '❓' };

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round((s - m * 60) * 10) / 10;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
export function parseTimeInput(v: string): number | null {
  const t = v.trim();
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function questionProblems(q: Question): string[] {
  const p: string[] = [];
  if (!q.text.trim()) p.push('No question text');
  if (q.answers.some((a) => !a.trim())) p.push('Empty answer');
  if (q.media.source === 'youtube' && !parseYouTube(q.media.url)) p.push('YouTube link missing or not valid');
  if (q.media.source === 'audio' && !q.media.url) p.push('Audio file missing');
  if (q.image && !q.image.url) p.push('Picture missing');
  if (q.kind === 'band' && !q.image) p.push('Band questions usually need a picture');
  return p;
}

export function Editor({ quizId, onAuthError }: { quizId: string; onAuthError: () => void }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [sel, setSel] = useState<number | 'settings'>(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const quizRef = useRef(quiz);
  quizRef.current = quiz;

  useEffect(() => {
    api<Quiz>(`/api/quizzes/${quizId}`)
      .then((q) => {
        setQuiz(q);
        if (!q.questions.length) setSel('settings');
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setErr(e.message)));
  }, [quizId]);

  const save = async () => {
    const q = quizRef.current;
    if (!q) return;
    setSaving(true);
    setErr('');
    try {
      const saved = await api<Quiz>(`/api/quizzes/${q.id}`, { method: 'PUT', body: q });
      if (quizRef.current === q) setDirty(false);
      void saved;
    } catch (e: any) {
      if (e instanceof AuthError) onAuthError();
      else setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty]);

  if (!quiz) return <div className="page">{err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>}</div>;

  const update = (fn: (q: Quiz) => Quiz) => {
    setQuiz((q) => (q ? fn(q) : q));
    setDirty(true);
  };
  const setQuestion = (i: number, patch: Partial<Question>) =>
    update((q) => ({ ...q, questions: q.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const addQuestion = (kind: QuestionKind) => {
    const nq = newQuestion(quiz.settings, kind);
    if (kind === 'band') nq.image = { url: '', reveal: 'tiles', grid: 4 };
    const at = typeof sel === 'number' ? sel + 1 : quiz.questions.length;
    update((q) => {
      const qs = [...q.questions];
      qs.splice(at, 0, nq);
      return { ...q, questions: qs };
    });
    setSel(at);
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= quiz.questions.length) return;
    update((q) => {
      const qs = [...q.questions];
      [qs[i], qs[j]] = [qs[j], qs[i]];
      return { ...q, questions: qs };
    });
    setSel(j);
  };

  const duplicate = (i: number) => {
    update((q) => {
      const qs = [...q.questions];
      qs.splice(i + 1, 0, { ...structuredClone(qs[i]), id: uid() });
      return { ...q, questions: qs };
    });
    setSel(i + 1);
  };

  const remove = (i: number) => {
    if (!confirm('Delete this question?')) return;
    update((q) => ({ ...q, questions: q.questions.filter((_, j) => j !== i) }));
    setSel(Math.max(0, Math.min(i, quiz.questions.length - 2)));
  };

  const startGame = async () => {
    if (dirty) await save();
    try {
      const { code } = await api<{ code: string }>('/api/games', { method: 'POST', body: { quizId: quiz.id } });
      go(`/live/${code}`);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const current = typeof sel === 'number' ? quiz.questions[sel] : null;

  return (
    <div className="editor">
      <header className="topbar">
        <div className="row" style={{ flex: 1, minWidth: 0 }}>
          <button
            className="btn"
            onClick={() => {
              if (!dirty || confirm('You have unsaved changes. Leave anyway?')) go('/');
            }}
          >
            ← Quizzes
          </button>
          <input
            className="title-input"
            value={quiz.title}
            onChange={(e) => update((q) => ({ ...q, title: e.target.value }))}
            placeholder="Quiz title"
          />
        </div>
        <div className="row">
          <span className="muted small">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>
            Save
          </button>
          <button className="btn" onClick={startGame} disabled={!quiz.questions.length}>
            ▶ Start game
          </button>
        </div>
      </header>
      {err && <p className="error" style={{ padding: '0 16px' }}>{err}</p>}

      <div className="editor-body">
        <aside className="qlist">
          <button className={`qitem ${sel === 'settings' ? 'active' : ''}`} onClick={() => setSel('settings')}>
            <span>⚙</span>
            <span className="qtext">Quiz settings</span>
          </button>
          {quiz.questions.map((q, i) => {
            const problems = questionProblems(q);
            return (
              <button key={q.id} className={`qitem ${sel === i ? 'active' : ''}`} onClick={() => setSel(i)}>
                <span className="qnum">{i + 1}</span>
                <span>{KIND_ICON[q.kind]}</span>
                <span className="qtext">{q.answers[q.correct] || q.text || 'New question'}</span>
                {problems.length > 0 && (
                  <span title={problems.join('\n')} className="warn">
                    ⚠
                  </span>
                )}
              </button>
            );
          })}
          <div className="add-q">
            <span className="muted small">Add question</span>
            <div className="add-grid">
              <button className="btn small" onClick={() => addQuestion('song')}>
                🎵 Song
              </button>
              <button className="btn small" onClick={() => addQuestion('singer')}>
                🎤 Singer
              </button>
              <button className="btn small" onClick={() => addQuestion('band')}>
                🖼 Band photo
              </button>
              <button className="btn small" onClick={() => addQuestion('other')}>
                ❓ Other
              </button>
            </div>
          </div>
        </aside>

        <main className="qedit">
          {sel === 'settings' && (
            <SettingsForm
              quiz={quiz}
              onChange={(patch) => update((q) => ({ ...q, ...patch }))}
              onApplyDefaults={(s) =>
                update((q) => ({ ...q, questions: q.questions.map((x) => ({ ...x, timeLimit: s.defaultTime, points: s.defaultPoints })) }))
              }
            />
          )}
          {current && typeof sel === 'number' && (
            <>
              <div className="row qtools">
                <strong>
                  Question {sel + 1} of {quiz.questions.length}
                </strong>
                <span style={{ flex: 1 }} />
                <button className="btn small" onClick={() => move(sel, -1)} disabled={sel === 0}>
                  ↑ Up
                </button>
                <button className="btn small" onClick={() => move(sel, 1)} disabled={sel === quiz.questions.length - 1}>
                  ↓ Down
                </button>
                <button className="btn small" onClick={() => duplicate(sel)}>
                  Duplicate
                </button>
                <button className="btn small danger" onClick={() => remove(sel)}>
                  Delete
                </button>
              </div>
              <QuestionForm key={current.id} q={current} onChange={(patch) => setQuestion(sel, patch)} />
            </>
          )}
          {sel !== 'settings' && !current && <p className="muted">Add a question from the list on the left.</p>}
        </main>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row nowrap">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="muted small">{suffix}</span>}
      </div>
    </label>
  );
}

function SettingsForm({ quiz, onChange, onApplyDefaults }: { quiz: Quiz; onChange: (p: Partial<Quiz>) => void; onApplyDefaults: (s: QuizSettings) => void }) {
  const s = quiz.settings;
  const set = (patch: Partial<QuizSettings>) => onChange({ settings: { ...s, ...patch } });
  return (
    <div className="form">
      <h2>Quiz settings</h2>
      <label className="field">
        <span>Description (only for you)</span>
        <textarea rows={2} value={quiz.description} onChange={(e) => onChange({ description: e.target.value })} />
      </label>
      <div className="grid3">
        <NumberField label="Default answer time" value={s.defaultTime} min={5} max={300} suffix="sec" onChange={(v) => set({ defaultTime: v })} />
        <NumberField label="Default points for a correct answer" value={s.defaultPoints} onChange={(v) => set({ defaultPoints: v })} />
        <NumberField label="Bonus for first correct answer" value={s.firstBonus} onChange={(v) => set({ firstBonus: v })} />
      </div>
      <button className="btn small" onClick={() => onApplyDefaults(s)}>
        Apply default time and points to all questions
      </button>
      <div className="grid3">
        <label className="field">
          <span>Bingo numbers</span>
          <select value={s.bingoMax} onChange={(e) => set({ bingoMax: Number(e.target.value) as 75 | 90 })}>
            <option value={75}>1–75 (B-I-N-G-O cards)</option>
            <option value={90}>1–90</option>
          </select>
        </label>
        <label className="field">
          <span>Group score</span>
          <select value={s.groupScoring} onChange={(e) => set({ groupScoring: e.target.value as 'sum' | 'average' })}>
            <option value="sum">Sum of members' points</option>
            <option value="average">Average per member (fair for groups of different sizes)</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.answersOnPhones} onChange={(e) => set({ answersOnPhones: e.target.checked })} />
        Show answer texts on phones (off = phones show only the coloured shapes)
      </label>
      <label className="check">
        <input type="checkbox" checked={s.autoReveal} onChange={(e) => set({ autoReveal: e.target.checked })} />
        Show the right answer automatically when time is up or everyone has answered
      </label>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const bad = parseTimeInput(text) == null;
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        className={bad ? 'invalid' : ''}
        placeholder="m:ss"
        onChange={(e) => {
          setText(e.target.value);
          const v = parseTimeInput(e.target.value);
          if (v != null) onChange(v);
        }}
        onBlur={() => setText(formatTime(value))}
      />
    </label>
  );
}

function UploadButton({ accept, onUploaded, label }: { accept: string; onUploaded: (url: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn small" type="button" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Uploading…' : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setErr('');
          try {
            onUploaded(await uploadFile(f));
          } catch (x: any) {
            setErr(x.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {err && <span className="error small">{err}</span>}
    </>
  );
}

function QuestionForm({ q, onChange }: { q: Question; onChange: (p: Partial<Question>) => void }) {
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  const [revealPreview, setRevealPreview] = useState(0.3);
  const media = q.media;
  const setMedia = (p: Partial<Question['media']>) => onChange({ media: { ...media, ...p } });
  const yt = media.source === 'youtube' ? parseYouTube(media.url) : null;

  const setAnswer = (i: number, v: string) => onChange({ answers: q.answers.map((a, j) => (j === i ? v : a)) });

  return (
    <div className="form">
      <div className="grid3">
        <label className="field">
          <span>Type</span>
          <select value={q.kind} onChange={(e) => onChange({ kind: e.target.value as QuestionKind })}>
            {(Object.keys(KIND_LABELS) as QuestionKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_ICON[k]} {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Time to answer" value={q.timeLimit} min={5} max={300} suffix="sec" onChange={(v) => onChange({ timeLimit: v })} />
        <NumberField label="Points" value={q.points} onChange={(v) => onChange({ points: v })} />
      </div>

      <label className="field">
        <span>Question</span>
        <input value={q.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="e.g. What is this song?" />
      </label>

      <div className="field">
        <span>Answers · tick the right one</span>
        <div className="answers-edit">
          {q.answers.map((a, i) => (
            <div key={i} className={`answer-edit ${q.correct === i ? 'is-correct' : ''}`} style={{ borderColor: answerColor(i) }}>
              <span className="answer-badge" style={{ background: answerColor(i) }} title={ANSWER_STYLES[i].name}>
                <AnswerIcon index={i} size={22} />
              </span>
              <input value={a} onChange={(e) => setAnswer(i, e.target.value)} placeholder={`Answer ${i + 1}`} />
              <label className="correct-pick" title="Right answer">
                <input type="radio" name={`correct-${q.id}`} checked={q.correct === i} onChange={() => onChange({ correct: i })} />
                {q.correct === i ? '✔ Right' : 'Right?'}
              </label>
              {q.answers.length > 2 && (
                <button
                  className="btn small"
                  title="Remove answer"
                  onClick={() => {
                    const answers = q.answers.filter((_, j) => j !== i);
                    onChange({ answers, correct: q.correct === i ? 0 : q.correct > i ? q.correct - 1 : q.correct });
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {q.answers.length < 4 && (
            <button className="btn small" onClick={() => onChange({ answers: [...q.answers, ''] })}>
              ＋ Add answer
            </button>
          )}
        </div>
      </div>

      <fieldset className="panel">
        <legend>🎵 Music clip</legend>
        <div className="row">
          {(['none', 'youtube', 'audio'] as const).map((src) => (
            <label key={src} className="check">
              <input type="radio" checked={media.source === src} onChange={() => setMedia({ source: src })} />
              {src === 'none' ? 'No music' : src === 'youtube' ? 'YouTube' : 'Audio file (mp3…)'}
            </label>
          ))}
        </div>
        {media.source !== 'none' && (
          <>
            {media.source === 'youtube' ? (
              <label className="field">
                <span>YouTube link</span>
                <input
                  value={media.url}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className={media.url && !yt ? 'invalid' : ''}
                  onChange={(e) => {
                    const url = e.target.value;
                    const parsed = parseYouTube(url);
                    setMedia(parsed?.start != null ? { url, start: parsed.start } : { url });
                  }}
                />
                {media.url && !yt && <span className="error small">That doesn't look like a YouTube video link.</span>}
              </label>
            ) : (
              <div className="field">
                <span>Audio file</span>
                <div className="row nowrap">
                  <input value={media.url} placeholder="Upload a file or paste a link to an mp3" onChange={(e) => setMedia({ url: e.target.value })} />
                  <UploadButton accept="audio/*" label="Upload…" onUploaded={(url) => setMedia({ url })} />
                </div>
              </div>
            )}
            <div className="grid3">
              <TimeField label="Start at (m:ss)" value={media.start} onChange={(v) => setMedia({ start: v })} />
              <NumberField label="Play for" value={media.duration} min={1} max={600} suffix="sec" onChange={(v) => setMedia({ duration: v })} />
              {media.source === 'youtube' && (
                <label className="check" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" checked={media.showVideo} onChange={(e) => setMedia({ showVideo: e.target.checked })} />
                  Show the video on the big screen
                </label>
              )}
            </div>
            <div className="row">
              <button className="btn small" disabled={!(yt || (media.source === 'audio' && media.url))} onClick={() => setPreviewKey(Date.now())}>
                ▶ Preview clip
              </button>
              {previewKey != null && (
                <button className="btn small" onClick={() => setPreviewKey(null)}>
                  ■ Stop
                </button>
              )}
              <span className="muted small">
                Plays {formatTime(media.start)} → {formatTime(media.start + media.duration)}
              </span>
            </div>
            {previewKey != null && (
              <div className="preview-box">
                <ClipPlayer media={media} playKey={previewKey} showVideo={media.source === 'youtube'} />
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="panel">
        <legend>🖼 Picture</legend>
        {!q.image ? (
          <button className="btn small" onClick={() => onChange({ image: { url: '', reveal: 'tiles', grid: 4 } })}>
            ＋ Add a picture
          </button>
        ) : (
          <>
            <div className="field">
              <span>Picture</span>
              <div className="row nowrap">
                <input value={q.image.url} placeholder="Upload a picture or paste an image link" onChange={(e) => onChange({ image: { ...q.image!, url: e.target.value } })} />
                <UploadButton accept="image/*" label="Upload…" onUploaded={(url) => onChange({ image: { ...q.image!, url } })} />
                <button className="btn small danger" onClick={() => onChange({ image: null })}>
                  Remove
                </button>
              </div>
            </div>
            <div className="grid3">
              <label className="field">
                <span>How it appears</span>
                <select value={q.image.reveal} onChange={(e) => onChange({ image: { ...q.image!, reveal: e.target.value as any } })}>
                  <option value="tiles">Piece by piece (tiles)</option>
                  <option value="blur">From blurry to sharp</option>
                  <option value="none">Shown at once</option>
                </select>
              </label>
              {q.image.reveal === 'tiles' && (
                <label className="field">
                  <span>Pieces</span>
                  <select value={q.image.grid} onChange={(e) => onChange({ image: { ...q.image!, grid: Number(e.target.value) } })}>
                    {[2, 3, 4, 5, 6, 8].map((g) => (
                      <option key={g} value={g}>
                        {g} × {g} = {g * g} pieces
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {q.image.reveal !== 'none' && (
                <label className="field">
                  <span>Preview: {Math.round(revealPreview * 100)}% of the time gone</span>
                  <input type="range" min={0} max={1} step={0.01} value={revealPreview} onChange={(e) => setRevealPreview(Number(e.target.value))} />
                </label>
              )}
            </div>
            {q.image.url && (
              <div className="image-preview">
                <ImageReveal image={q.image} progress={revealPreview} full={false} seed={q.id} />
              </div>
            )}
          </>
        )}
      </fieldset>
    </div>
  );
}
