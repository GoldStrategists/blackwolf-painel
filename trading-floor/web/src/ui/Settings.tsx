import { useCallback, useEffect, useState } from 'react';
import type { AccountConfig } from '@bw/shared';
import { api } from '../lib/api';
import { useFloor } from '../lib/store';
import { dateTime } from '../lib/format';

type Tab = 'rooms' | 'accounts' | 'integrations' | 'about';

export function Settings() {
  const open = useFloor((s) => s.settingsOpen);
  const [tab, setTab] = useState<Tab>('accounts');
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={() => useFloor.getState().setSettingsOpen(false)}>
      <div className="glass flex max-h-[90vh] w-[min(920px,100%)] flex-col overflow-hidden rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-wolf-700 px-4 py-3">
          <div className="flex gap-1">
            {(
              [
                ['accounts', 'Contas e mesas'],
                ['rooms', 'Salas'],
                ['integrations', 'Integrações'],
                ['about', 'Limitações'],
              ] as const
            ).map(([t, l]) => (
              <button key={t} className={`btn ${tab === t ? 'btn-on' : ''}`} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => useFloor.getState().setSettingsOpen(false)}>
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          {tab === 'accounts' && <AccountsTab />}
          {tab === 'rooms' && <RoomsTab />}
          {tab === 'integrations' && <IntegrationsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function useAccounts() {
  const mode = useFloor((s) => s.mode);
  const [list, setList] = useState<AccountConfig[]>([]);
  const reload = useCallback(() => {
    api<AccountConfig[]>(`/api/${mode}/accounts`).then(setList).catch(() => undefined);
  }, [mode]);
  useEffect(reload, [reload]);
  return { list, reload, mode };
}

function AccountsTab() {
  const rooms = useFloor((s) => s.rooms);
  const { list, reload, mode } = useAccounts();
  const [err, setErr] = useState<string | null>(null);
  const [newAcc, setNewAcc] = useState({ name: '', roomId: '', provider: '' });

  const patch = async (id: string, body: object) => {
    setErr(null);
    try {
      await api(`/api/${mode}/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const move = async (roomId: string, ids: string[], from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    await api(`/api/${mode}/rooms/${roomId}/order`, { method: 'POST', body: { ids: next } });
    reload();
  };

  return (
    <div className="space-y-5">
      {err && <p className="text-neg">{err}</p>}
      {rooms.map((room) => {
        const accs = list.filter((a) => a.roomId === room.id).sort((a, b) => a.deskIndex - b.deskIndex);
        const ids = accs.map((a) => a.id);
        return (
          <section key={room.id}>
            <h3 className="kpi-label mb-1.5">
              {room.name} ({accs.length})
            </h3>
            {accs.length === 0 && <p className="text-xs text-wolf-500">Sala vazia.</p>}
            <div className="space-y-1">
              {accs.map((a, i) => (
                <div key={a.id} className={`flex flex-wrap items-center gap-2 rounded-md bg-wolf-850 px-2 py-1.5 ${a.hidden ? 'opacity-50' : ''}`}>
                  <div className="flex flex-col">
                    <button className="text-[10px] leading-none text-wolf-400 hover:text-white" onClick={() => move(room.id, ids, i, i - 1)} aria-label="Subir">
                      ▲
                    </button>
                    <button className="text-[10px] leading-none text-wolf-400 hover:text-white" onClick={() => move(room.id, ids, i, i + 1)} aria-label="Descer">
                      ▼
                    </button>
                  </div>
                  <input
                    className="input w-44 py-1 text-xs"
                    defaultValue={a.displayName}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== a.displayName && patch(a.id, { displayName: e.target.value.trim() })}
                    aria-label="Nome da estação"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-wolf-400">
                    {a.name} · {a.provider ?? 'conexão ?'}
                  </span>
                  <select className="input w-48 py-1 text-xs" value={a.roomId} onChange={(e) => patch(a.id, { roomId: e.target.value })} aria-label="Mover para sala">
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn py-1" onClick={() => patch(a.id, { hidden: !a.hidden })}>
                    {a.hidden ? 'Mostrar' : 'Ocultar'}
                  </button>
                  <button
                    className="btn btn-danger py-1"
                    onClick={async () => {
                      if (!window.confirm(`Remover o cadastro de ${a.name}? Se o coletor voltar a enviar esta conta, ela reaparece.`)) return;
                      await api(`/api/${mode}/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
                      reload();
                    }}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <section className="rounded-lg border border-wolf-700 p-3">
        <h3 className="kpi-label mb-2">Cadastrar conta manualmente</h3>
        <p className="mb-2 text-xs text-wolf-400">
          Opcional: contas LIVE aparecem sozinhas quando o coletor envia dados. Cadastre antes para já deixar a mesa na sala certa. Use exatamente o nome da conta como aparece no NinjaTrader.
        </p>
        <div className="flex flex-wrap gap-2">
          <input className="input w-56" placeholder="Nome da conta (ex.: APEX-123456-01)" value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} />
          <select className="input w-56" value={newAcc.roomId} onChange={(e) => setNewAcc({ ...newAcc, roomId: e.target.value })}>
            <option value="">Sala…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select className="input w-40" value={newAcc.provider} onChange={(e) => setNewAcc({ ...newAcc, provider: e.target.value })}>
            <option value="">Conexão…</option>
            <option>Rithmic</option>
            <option>Tradovate</option>
            <option>Outra</option>
          </select>
          <button
            className="btn btn-on"
            disabled={!newAcc.name || !newAcc.roomId}
            onClick={async () => {
              setErr(null);
              try {
                await api(`/api/${mode}/accounts`, { method: 'POST', body: { name: newAcc.name.trim(), roomId: newAcc.roomId, provider: newAcc.provider || null } });
                setNewAcc({ name: '', roomId: '', provider: '' });
                reload();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Cadastrar
          </button>
        </div>
      </section>
    </div>
  );
}

function RoomsTab() {
  const rooms = useFloor((s) => s.rooms);
  const mode = useFloor((s) => s.mode);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const save = async (id: string, body: { name: string; sort: number }) => {
    setErr(null);
    try {
      await api(`/api/${mode}/rooms/${id}`, { method: 'PUT', body });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="space-y-2">
      {err && <p className="text-neg">{err}</p>}
      {rooms.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-md bg-wolf-850 px-2 py-1.5">
          <input className="input w-16 py-1 text-xs" type="number" defaultValue={r.sort} onBlur={(e) => save(r.id, { name: r.name, sort: Number(e.target.value) || 0 })} aria-label="Ordem" />
          <input className="input flex-1 py-1" defaultValue={r.name} onBlur={(e) => e.target.value.trim() && save(r.id, { name: e.target.value.trim(), sort: r.sort })} aria-label="Nome da sala" />
          <span className="font-mono text-[11px] text-wolf-500">{r.id}</span>
          <button
            className="btn btn-danger py-1"
            onClick={async () => {
              setErr(null);
              try {
                await api(`/api/${mode}/rooms/${r.id}`, { method: 'DELETE' });
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Excluir
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input" placeholder="Nova sala (ex.: SALA 5 · TOPSTEP)" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn btn-on"
          disabled={!name.trim()}
          onClick={async () => {
            const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `sala-${Date.now()}`;
            await save(id, { name: name.trim(), sort: rooms.length + 1 });
            setName('');
          }}
        >
          Criar sala
        </button>
      </div>
      <p className="text-[11px] text-wolf-500">Salas do modo {mode.toUpperCase()}. DEMO e LIVE têm organizações separadas.</p>
    </div>
  );
}

interface TokenRow {
  id: number;
  name: string;
  kind: 'nt8' | 'robot';
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function IntegrationsTab() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState('pc-ninjatrader');
  const [kind, setKind] = useState<'nt8' | 'robot'>('nt8');
  const reload = useCallback(() => {
    api<TokenRow[]>('/api/tokens').then(setTokens).catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  const origin = location.origin.replace(':5173', ':4100');
  return (
    <div className="space-y-4">
      <section>
        <h3 className="kpi-label mb-1">Tokens de integração</h3>
        <p className="mb-2 text-xs text-wolf-400">
          O coletor do NinjaTrader e o robô usam um token próprio, que só permite ENVIAR dados (não lê nada e não opera). Senhas de corretora nunca passam por aqui.
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <input className="input w-48" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input w-56" value={kind} onChange={(e) => setKind(e.target.value as 'nt8' | 'robot')}>
            <option value="nt8">Coletor NinjaTrader 8</option>
            <option value="robot">Robô Black Wolf (eventos)</option>
          </select>
          <button
            className="btn btn-on"
            onClick={async () => {
              const r = await api<{ token: string }>('/api/tokens', { method: 'POST', body: { name, kind } });
              setCreated(r.token);
              reload();
            }}
          >
            Gerar token
          </button>
        </div>
        {created && (
          <div className="mb-3 rounded-md border border-warn/50 bg-warn/10 p-3 text-xs">
            <div className="mb-1 font-bold text-warn">Copie agora — este token não será mostrado novamente:</div>
            <code className="block select-all break-all rounded bg-black/50 p-2 font-mono text-wolf-200">{created}</code>
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="text-left text-wolf-500">
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Criado</th>
              <th>Último uso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={`border-t border-wolf-800 ${t.revokedAt ? 'opacity-40' : ''}`}>
                <td className="py-1">{t.name}</td>
                <td>{t.kind === 'nt8' ? 'NinjaTrader' : 'Robô'}</td>
                <td>{dateTime(Date.parse(t.createdAt))}</td>
                <td>{t.lastUsedAt ? dateTime(Date.parse(t.lastUsedAt)) : 'nunca'}</td>
                <td className="text-right">
                  {!t.revokedAt && (
                    <button
                      className="btn btn-danger py-0.5"
                      onClick={async () => {
                        await api(`/api/tokens/${t.id}`, { method: 'DELETE' });
                        reload();
                      }}
                    >
                      Revogar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="space-y-1 text-xs text-wolf-300">
        <h3 className="kpi-label">Como conectar</h3>
        <p>
          <b>NinjaTrader 8:</b> copie <code>collector-nt8/BlackWolfFloorCollector.cs</code> para <code>Documentos\NinjaTrader 8\bin\Custom\AddOns</code>, compile (F5 no NinjaScript Editor) e crie{' '}
          <code>Documentos\NinjaTrader 8\BlackWolfFloor\collector.config</code> com <code>serverUrl={origin}</code> e <code>token=…</code>. Detalhes em <code>docs/NINJATRADER.md</code>.
        </p>
        <p>
          <b>Robô Black Wolf:</b> <code>POST {origin}/api/ingest/robot</code> com <code>Authorization: Bearer &lt;token do robô&gt;</code>. Contrato em <code>docs/ROBO.md</code>. Para testar sem afetar o LIVE use <code>?target=demo</code>.
        </p>
      </section>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-wolf-300">
      <h3 className="kpi-label">O que este painel NÃO faz / não garante</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>É somente monitoramento: não envia, altera ou cancela ordens.</li>
        <li>O NinjaTrader não informa o limite de trailing drawdown da prop firm; o valor mostrado é calculado localmente ou informado por você.</li>
        <li>Alguns campos (saldo, P&L realizado) dependem do que a conexão Rithmic/Tradovate envia ao NinjaTrader. Campo ausente aparece como “—”, nunca como zero.</li>
        <li>P&L não realizado de uma posição depende de cotação ativa do instrumento no NinjaTrader.</li>
        <li>Latência: o painel atualiza cerca de 1×/s quando a fonte envia; não há latência garantida.</li>
        <li>Capital nominal é a soma do tamanho das contas, não dinheiro próprio.</li>
        <li>O histórico LIVE começa quando o coletor passa a enviar dados; não há importação de histórico antigo da corretora.</li>
      </ul>
      <p>Lista completa em README.md → “Limitações e pendências”.</p>
    </div>
  );
}
