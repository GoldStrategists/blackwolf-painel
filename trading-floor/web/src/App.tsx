import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { FloorSocket } from './lib/ws';
import { Login } from './ui/Login';
import { TopBar } from './ui/TopBar';
import { SummaryStrip } from './ui/SummaryStrip';
import { ActivityFeed } from './ui/ActivityFeed';
import { AccountDrawer } from './ui/AccountDrawer';
import { Settings } from './ui/Settings';
import { ModeBanner } from './ui/ModeBanner';
import { useFloor } from './lib/store';

const FloorScene = lazy(() => import('./scene/FloorScene').then((m) => ({ default: m.FloorScene })));

interface Me {
  user: { id: number; username: string } | null;
  needsSetup: boolean;
  setupAllowed: boolean;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const refresh = useCallback(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => setMe({ user: null, needsSetup: false, setupAllowed: false }));
  }, []);
  useEffect(refresh, [refresh]);

  if (!me) return <div className="grid h-full place-items-center text-wolf-400">Carregando…</div>;
  if (!me.user) return <Login needsSetup={me.needsSetup} setupAllowed={me.setupAllowed} onDone={refresh} />;
  return <Floor username={me.user.username} onLogout={refresh} />;
}

function Floor({ username, onLogout }: { username: string; onLogout: () => void }) {
  const ready = useFloor((s) => s.ready);
  const count = useFloor((s) => s.order.length);
  const mode = useFloor((s) => s.mode);
  useEffect(() => {
    const sock = new FloorSocket(onLogout);
    sock.start();
    return () => sock.stop();
  }, [onLogout]);

  return (
    <div className="relative h-full w-full">
      <Suspense fallback={<div className="grid h-full place-items-center text-wolf-400">Carregando sala 3D…</div>}>
        <FloorScene />
      </Suspense>
      <ModeBanner />
      <TopBar username={username} onLogout={onLogout} />
      <SummaryStrip />
      <ActivityFeed />
      <AccountDrawer />
      <Settings />
      {ready && count === 0 && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 glass rounded-xl p-6 text-sm">
          <h2 className="mb-2 text-lg font-bold text-white">Nenhuma conta {mode === 'live' ? 'LIVE' : 'DEMO'} ainda</h2>
          {mode === 'live' ? (
            <p className="text-wolf-300">
              Instale o coletor no NinjaTrader 8 (veja <b>Configurações → Integrações</b> e <code>docs/NINJATRADER.md</code>). As contas aparecem
              aqui automaticamente quando o coletor enviar os primeiros dados.
            </p>
          ) : (
            <p className="text-wolf-300">O simulador DEMO está desligado no servidor (BW_DISABLE_DEMO=1).</p>
          )}
        </div>
      )}
    </div>
  );
}
