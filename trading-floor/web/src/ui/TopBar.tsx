import { api } from '../lib/api';
import { useFloor, isServerLive, type CameraMode, type Quality } from '../lib/store';
import { ago } from '../lib/format';
import { useNow } from './useNow';

export function TopBar({ username, onLogout }: { username: string; onLogout: () => void }) {
  const mode = useFloor((s) => s.mode);
  const camera = useFloor((s) => s.camera);
  const rooms = useFloor((s) => s.rooms);
  const roomFilter = useFloor((s) => s.roomFilter);
  const quality = useFloor((s) => s.quality);
  const feedOpen = useFloor((s) => s.feedOpen);
  const st = useFloor.getState();

  const switchMode = (m: 'demo' | 'live') => {
    if (m === mode) return;
    if (m === 'live' && !window.confirm('Mudar para LIVE? Serão exibidos somente dados reais vindos do coletor NinjaTrader.')) return;
    st.setMode(m);
  };

  const cams: [CameraMode, string][] = [
    ['panorama', 'Panorâmica'],
    ['top', 'Superior'],
    ['free', 'Livre'],
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3 pt-6">
      <div className="pointer-events-auto glass flex items-center gap-3 rounded-xl px-3 py-2">
        <img src="/wolf.svg" alt="" className="h-8 w-8" />
        <div className="leading-tight">
          <div className="text-sm font-black tracking-wide text-brand">BLACK WOLF</div>
          <div className="text-[10px] font-light tracking-[0.3em] text-wolf-300">TRADING FLOOR</div>
        </div>
        <div className="ml-2 flex overflow-hidden rounded-lg border border-wolf-600" role="radiogroup" aria-label="Modo de dados">
          <button
            onClick={() => switchMode('demo')}
            className={`px-3 py-1.5 text-xs font-black tracking-wider ${mode === 'demo' ? 'bg-warn text-black' : 'bg-wolf-850 text-wolf-400 hover:text-white'}`}
            aria-checked={mode === 'demo'}
            role="radio"
          >
            DEMO
          </button>
          <button
            onClick={() => switchMode('live')}
            className={`px-3 py-1.5 text-xs font-black tracking-wider ${mode === 'live' ? 'bg-neg text-white' : 'bg-wolf-850 text-wolf-400 hover:text-white'}`}
            aria-checked={mode === 'live'}
            role="radio"
          >
            ● LIVE
          </button>
        </div>
      </div>

      <div className="pointer-events-auto glass flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1.5">
        <select className="input w-auto py-1 text-xs" value={roomFilter} onChange={(e) => st.setRoomFilter(e.target.value)} aria-label="Sala">
          <option value="all">Todas as salas</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="mx-1 h-5 w-px bg-wolf-600" />
        {cams.map(([c, label]) => (
          <button key={c} className={`btn ${camera === c ? 'btn-on' : ''}`} onClick={() => st.setCamera(c)} title={c === 'free' ? 'Arraste para girar, botão direito move, roda aproxima. Teclado: W A S D, Q/E sobe/desce, Shift acelera' : undefined}>
            {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-wolf-600" />
        <select className="input w-auto py-1 text-xs" value={quality} onChange={(e) => st.setQuality(e.target.value as Quality)} aria-label="Qualidade gráfica">
          <option value="low">Gráfico: leve</option>
          <option value="medium">Gráfico: médio</option>
          <option value="high">Gráfico: alto</option>
        </select>
        <span id="bw-fps" className="w-12 text-right font-mono text-[10px] text-wolf-400" title="Quadros por segundo da cena 3D" />
        <button className={`btn ${feedOpen ? 'btn-on' : ''}`} onClick={() => st.setFeedOpen(!feedOpen)}>
          Atividades
        </button>
        <button className="btn" onClick={() => st.setSettingsOpen(true)}>
          Configurações
        </button>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <ConnectionChip />
        <div className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-xs">
          <span className="text-wolf-300">{username}</span>
          <button
            className="btn py-1"
            onClick={async () => {
              await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
              onLogout();
            }}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionChip() {
  const ws = useFloor((s) => s.ws);
  const rtt = useFloor((s) => s.rttMs);
  const lastMessageAt = useFloor((s) => s.lastMessageAt);
  const summary = useFloor((s) => s.summary);
  const now = useNow(1000);
  const live = isServerLive({ ws, lastMessageAt }, now);
  const collectors = summary?.collectors ?? [];
  const col = collectors[0];
  const colOk = collectors.length > 0 && collectors.every((c) => now - c.lastSeenAt < 5000);
  return (
    <div className="glass rounded-xl px-3 py-1.5 text-[11px] leading-tight" title="RTT = ida e volta navegador↔servidor. Atraso do coletor depende do relógio do PC do NinjaTrader.">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${live ? 'bg-pos' : ws === 'connecting' ? 'bg-warn animate-pulse' : 'bg-neg'}`} />
        <span className="font-semibold text-wolf-200">Servidor {live ? 'ok' : ws === 'connecting' ? 'conectando' : 'offline'}</span>
        <span className="text-wolf-400">{rtt != null ? `${rtt} ms` : ''}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${colOk ? 'bg-pos' : collectors.length ? 'bg-neg' : 'bg-wolf-500'}`} />
        <span className="text-wolf-300">
          {col ? `${col.kind === 'demo' ? 'Simulador' : 'Coletor NT8'} · há ${ago(col.lastSeenAt, now)}${col.lagMs != null && col.kind !== 'demo' ? ` · atraso ~${Math.max(0, col.lagMs)} ms` : ''}` : 'Nenhum coletor conectado'}
        </span>
      </div>
    </div>
  );
}
