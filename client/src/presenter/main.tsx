import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../common/base.css';
import './presenter.css';
import { AuthError, api, setToken, useHashRoute } from './api.ts';
import { Home } from './Home.tsx';
import { Editor } from './Editor.tsx';
import { Live } from './Live.tsx';
import { Cards } from './Cards.tsx';

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="login">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ token: string }>('/api/login', { method: 'POST', body: { password: pw } });
            setToken(r.token);
            onDone();
          } catch (e: any) {
            setErr(e.message);
          }
        }}
      >
        <h1>🎵 Presenter login</h1>
        <input type="password" autoFocus placeholder="Presenter password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" style={{ width: '100%', marginTop: 12 }}>
          Log in
        </button>
      </form>
    </div>
  );
}

function App() {
  const route = useHashRoute();
  const [auth, setAuth] = useState<'checking' | 'ok' | 'login'>('checking');

  const check = async () => {
    try {
      await api('/api/quizzes');
      setAuth('ok');
    } catch (e) {
      setAuth(e instanceof AuthError ? 'login' : 'ok');
    }
  };
  useEffect(() => {
    void check();
  }, []);

  if (auth === 'checking') return null;
  if (auth === 'login') return <Login onDone={check} />;

  const onAuthError = () => setAuth('login');
  const [page, id] = route;
  if (page === 'quiz' && id) return <Editor key={id} quizId={id} onAuthError={onAuthError} />;
  if (page === 'live' && id) return <Live key={id} code={id} onAuthError={onAuthError} />;
  if (page === 'cards') return <Cards />;
  return <Home onAuthError={onAuthError} />;
}

createRoot(document.getElementById('root')!).render(<App />);
