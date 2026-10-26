import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';

export function Login({ needsSetup, setupAllowed, onDone }: { needsSetup: boolean; setupAllowed: boolean; onDone: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) return setError('As senhas não conferem');
    setBusy(true);
    try {
      if (needsSetup) await api('/api/auth/setup', { method: 'POST', body: { username, password } });
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-[radial-gradient(ellipse_at_top,#0d1d38_0%,#04060a_60%)] px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm rounded-2xl p-7">
        <div className="mb-6 text-center">
          <img src="/wolf.svg" alt="" className="mx-auto mb-3 h-14 w-14" />
          <div className="text-2xl font-black tracking-wide text-brand">BLACK WOLF</div>
          <div className="text-xs font-light tracking-[0.4em] text-wolf-300">TRADING FLOOR</div>
        </div>
        {needsSetup && !setupAllowed ? (
          <p className="text-sm text-warn">
            Nenhum usuário configurado. Crie a senha no próprio computador do servidor (<code>npm run user:set-password</code>) ou abra esta página em
            http://127.0.0.1.
          </p>
        ) : (
          <>
            {needsSetup && <p className="mb-4 rounded-md bg-brand/10 p-3 text-xs text-wolf-200">Primeiro acesso: defina o usuário e uma senha forte (mín. 10 caracteres). Esta senha é só do painel — nunca use a senha da corretora.</p>}
            <label className="label" htmlFor="bw-user">Usuário</label>
            <input id="bw-user" className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <label className="label" htmlFor="bw-pass">Senha</label>
            <input id="bw-pass" className="input mb-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} autoFocus />
            {needsSetup && (
              <>
                <label className="label" htmlFor="bw-pass2">Confirmar senha</label>
                <input id="bw-pass2" className="input mb-3" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </>
            )}
            {error && <p className="mb-3 text-sm text-neg">{error}</p>}
            <button className="btn btn-on w-full justify-center py-2 text-sm" disabled={busy || !password}>
              {needsSetup ? 'Criar acesso e entrar' : 'Entrar'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
