import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountView, ActivityEvent, EquityPoint, ExecutionRecord } from '@bw/shared';
import { useFloor, isServerLive } from '../lib/store';
import { api } from '../lib/api';
import { CONN_LABEL, STATUS_COLOR, STATUS_LABEL, pnlClass } from '../lib/colors';
import { ago, dateTime, money, NA, number, pct } from '../lib/format';
import { EquityChart } from './EquityChart';
import { EventRow } from './ActivityFeed';
import { AccountEditor } from './AccountEditor';
import { effectiveStatus } from '../scene/textures';
import { useNow } from './useNow';

type Period = 'today' | '7d' | '30d' | 'all' | 'custom';

function periodRange(p: Period, custom: { from: string; to: string }): { from: number; to: number } {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  switch (p) {
    case 'today':
      return { from: startOfDay.getTime(), to: now };
    case '7d':
      return { from: now - 7 * 86400_000, to: now };
    case '30d':
      return { from: now - 30 * 86400_000, to: now };
    case 'all':
      return { from: 0, to: now };
    case 'custom': {
      const from = custom.from ? new Date(custom.from + 'T00:00:00').getTime() : now - 86400_000;
      const to = custom.to ? new Date(custom.to + 'T23:59:59').getTime() : now;
      return { from, to };
    }
  }
}

interface History {
  equity: EquityPoint[];
  executions: ExecutionRecord[];
  events: ActivityEvent[];
}

export function AccountDrawer() {
  const id = useFloor((s) => s.selectedId);
  const account = useFloor((s) => (id ? s.accounts[id] : undefined));
  if (!id || !account) return null;
  return <Drawer key={id} a={account} />;
}

function Drawer({ a }: { a: AccountView }) {
  const mode = useFloor((s) => s.mode);
  const ws = useFloor((s) => s.ws);
  const lastMessageAt = useFloor((s) => s.lastMessageAt);
  const now = useNow(1000);
  const serverLive = isServerLive({ ws, lastMessageAt }, now);
  const status = effectiveStatus(a, serverLive);
  const [period, setPeriod] = useState<Period>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [hist, setHist] = useState<History | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'history' | 'config'>('overview');
  const [chartField, setChartField] = useState<'equity' | 'balance'>('equity');

  const load = useCallback(() => {
    const { from, to } = periodRange(period, custom);
    api<History>(`/api/${mode}/accounts/${encodeURIComponent(a.id)}/history?from=${from}&to=${to}`)
      .then((h) => {
        setHist(h);
        setHistErr(null);
      })
      .catch((e) => setHistErr((e as Error).message));
  }, [a.id, mode, period, custom]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  const grey = status === 'offline' || status === 'stale' || status === 'nodata';
  const kpis: [string, string, string?][] = [
    ['Saldo', money(a.balance)],
    ['Equity', money(a.equity)],
    ['P&L realizado (dia)', money(a.realizedToday, { sign: true }), pnlClass(a.realizedToday)],
    ['P&L não realizado', money(a.unrealized, { sign: true }), pnlClass(a.unrealized)],
    ['P&L total (dia)', money(a.totalToday, { sign: true }), pnlClass(a.totalToday)],
    ['P&L acumulado', money(a.cumulativePnl, { sign: true }), pnlClass(a.cumulativePnl)],
    ['Tamanho nominal', money(a.nominalSize)],
    ['Saldo inicial', money(a.startingBalance)],
  ];
  const instruments = useMemo(() => {
    const set = new Set<string>();
    a.positions.forEach((p) => set.add(p.instrument));
    hist?.executions.forEach((e) => set.add(e.instrument));
    return [...set];
  }, [a.positions, hist]);

  return (
    <aside className="pointer-events-auto glass absolute bottom-[86px] right-3 top-[92px] z-20 flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl">
      <div className="border-b border-wolf-700 p-4" style={{ boxShadow: `inset 0 3px 0 ${STATUS_COLOR[status]}` }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{a.displayName}</div>
            <div className="truncate text-xs text-wolf-400">
              {a.name !== a.displayName && <span className="mr-1 font-mono">{a.name} ·</span>}
              {[a.platform, a.provider, a.connectionName, a.firm, a.plan].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className="btn" onClick={() => useFloor.getState().select(null)} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded px-2 py-0.5 font-black text-black" style={{ background: STATUS_COLOR[status] }}>
            {STATUS_LABEL[status]}
          </span>
          <span className="text-wolf-300">Conexão: {CONN_LABEL[a.connStatus]}</span>
          <span className="text-wolf-500">· atualizado há {ago(a.lastUpdateAt, now)}</span>
          {mode === 'demo' && <span className="rounded bg-warn px-1.5 py-0.5 font-black text-black">DEMO</span>}
        </div>
        <div className="mt-3 flex gap-1">
          {(
            [
              ['overview', 'Visão geral'],
              ['history', 'Histórico'],
              ['config', 'Configurar'],
            ] as const
          ).map(([t, l]) => (
            <button key={t} className={`btn ${tab === t ? 'btn-on' : ''}`} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {a.alerts.length > 0 && tab !== 'config' && (
          <ul className="space-y-1">
            {a.alerts.map((al) => (
              <li key={al} className={`rounded-md px-2.5 py-1.5 text-xs ${/LIMITE|perdida|ÚLTIMOS|não aparece/i.test(al) ? 'bg-neg/15 text-neg' : /Próxima|não configurad|não informou|indisponível/i.test(al) ? 'bg-warn/10 text-warn' : 'bg-wolf-800 text-wolf-300'}`}>
                {al}
              </li>
            ))}
          </ul>
        )}

        {tab === 'overview' && (
          <>
            <div className={`grid grid-cols-2 gap-2 ${grey ? 'opacity-60' : ''}`}>
              {kpis.map(([l, v, c]) => (
                <div key={l} className="rounded-lg bg-wolf-850 px-3 py-2">
                  <div className="kpi-label">{l}</div>
                  <div className={`kpi-value ${c ?? 'text-wolf-200'}`}>{v}</div>
                </div>
              ))}
            </div>
            {grey && <p className="text-[11px] text-warn">Valores acima são os últimos conhecidos e podem não refletir a conta agora.</p>}

            <RiskCard a={a} />

            <section>
              <h3 className="kpi-label mb-1.5">Posições abertas ({a.positions.length})</h3>
              {a.positions.length === 0 ? (
                <p className="text-xs text-wolf-500">Nenhuma.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-wolf-500">
                    <tr>
                      <th>Instrumento</th>
                      <th>Lado</th>
                      <th className="text-right">Qtd</th>
                      <th className="text-right">Preço médio</th>
                      <th className="text-right">Não realiz.</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {a.positions.map((p) => (
                      <tr key={p.instrument} className="border-t border-wolf-800">
                        <td className="py-1">{p.instrument}</td>
                        <td className={p.side === 'long' ? 'text-pos' : 'text-neg'}>{p.side === 'long' ? 'Compra' : 'Venda'}</td>
                        <td className="text-right">{p.quantity}</td>
                        <td className="text-right">{number(p.avgPrice)}</td>
                        <td className={`text-right ${pnlClass(p.unrealized)}`}>{p.unrealized == null ? 'indisp.' : money(p.unrealized)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h3 className="kpi-label mb-1.5">Ordens ativas ({a.orders.length}) — somente leitura</h3>
              {a.orders.length === 0 ? (
                <p className="text-xs text-wolf-500">Nenhuma.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody className="font-mono">
                    {a.orders.map((o) => (
                      <tr key={o.orderId} className="border-t border-wolf-800">
                        <td className="py-1">{o.instrument}</td>
                        <td>{o.action}</td>
                        <td>{o.type}</td>
                        <td className="text-right">
                          {o.filled}/{o.quantity}
                        </td>
                        <td className="text-right">{o.limitPrice ?? o.stopPrice ?? NA}</td>
                        <td className="text-wolf-400">{o.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section>
              <h3 className="kpi-label mb-1.5">Instrumentos negociados</h3>
              <p className="text-xs text-wolf-300">{instruments.length ? instruments.join(', ') : 'Nenhum no período.'}</p>
            </section>
            <p className="text-[10px] text-wolf-500">Campos informados pela conexão: {a.available.length ? a.available.join(', ') : 'nenhum'}.</p>
          </>
        )}

        {tab === 'history' && (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['today', 'Hoje'],
                  ['7d', '7 dias'],
                  ['30d', '30 dias'],
                  ['all', 'Tudo'],
                  ['custom', 'Período'],
                ] as const
              ).map(([p, l]) => (
                <button key={p} className={`btn ${period === p ? 'btn-on' : ''}`} onClick={() => setPeriod(p)}>
                  {l}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex gap-2">
                <input type="date" className="input" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="De" />
                <input type="date" className="input" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Até" />
              </div>
            )}
            {histErr && <p className="text-xs text-neg">{histErr}</p>}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="kpi-label">Evolução</h3>
                <div className="flex gap-1">
                  <button className={`btn px-2 py-0.5 text-[10px] ${chartField === 'equity' ? 'btn-on' : ''}`} onClick={() => setChartField('equity')}>
                    Equity
                  </button>
                  <button className={`btn px-2 py-0.5 text-[10px] ${chartField === 'balance' ? 'btn-on' : ''}`} onClick={() => setChartField('balance')}>
                    Saldo
                  </button>
                </div>
              </div>
              {hist && hist.equity.length > 1 ? <EquityChart points={hist.equity} field={chartField} /> : <p className="text-xs text-wolf-500">Sem pontos suficientes no período (o histórico LIVE começa quando o coletor passa a enviar dados).</p>}
            </section>
            <section>
              <h3 className="kpi-label mb-1.5">Execuções confirmadas ({hist?.executions.length ?? 0})</h3>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody className="font-mono">
                    {hist?.executions.map((e) => (
                      <tr key={e.execId} className="border-t border-wolf-800">
                        <td className="py-1 text-wolf-400">{dateTime(e.ts)}</td>
                        <td className={e.side === 'buy' ? 'text-pos' : 'text-neg'}>{e.side === 'buy' ? 'C' : 'V'}</td>
                        <td>{e.quantity}</td>
                        <td>{e.instrument}</td>
                        <td className="text-right">{number(e.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h3 className="kpi-label mb-1.5">Eventos da conta</h3>
              <div className="rounded-lg bg-wolf-950/60">{hist?.events.length ? hist.events.slice(0, 80).map((e) => <EventRow key={e.id} e={e} showAccount={false} />) : <p className="p-3 text-xs text-wolf-500">Nenhum.</p>}</div>
            </section>
          </>
        )}

        {tab === 'config' && <AccountEditor a={a} />}
      </div>
    </aside>
  );
}

function RiskCard({ a }: { a: AccountView }) {
  const r = a.risk;
  const label: Record<string, string> = { none: 'Sem regra', static: 'Drawdown estático', trailing_intraday: 'Trailing intraday', trailing_eod: 'Trailing fim do dia (EOD)' };
  const bar = (used: number | null, level: string) =>
    used == null ? null : (
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-wolf-800">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, used * 100)}%`, background: used >= 1 ? '#ff4053' : level === 'warn' ? '#ffc533' : '#2f7bff' }} />
      </div>
    );
  return (
    <section className="rounded-lg border border-wolf-700 p-3">
      <div className="flex items-center justify-between">
        <h3 className="kpi-label">Risco · {label[r.ruleType]}</h3>
        <span className={`text-[10px] font-bold ${r.source === 'manual' ? 'text-pos' : r.source === 'computed' ? 'text-warn' : 'text-wolf-500'}`}>
          {r.source === 'manual' ? 'limite informado por você' : r.source === 'computed' ? 'calculado localmente' : 'não calculável'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-wolf-400">Drawdown máximo</span>
        <span className="text-right font-mono">{money(r.maxDrawdown)}</span>
        <span className="text-wolf-400">Limite de liquidação</span>
        <span className="text-right font-mono">{money(r.liquidationThreshold)}</span>
        <span className="text-wolf-400">Drawdown disponível</span>
        <span className={`text-right font-mono font-bold ${r.level === 'breach' ? 'text-neg' : r.level === 'warn' ? 'text-warn' : 'text-wolf-200'}`}>{money(r.drawdownRemaining)}</span>
        <span className="text-wolf-400">Consumido</span>
        <span className="text-right font-mono">{pct(r.drawdownUsedPct)}</span>
      </div>
      {bar(r.drawdownUsedPct, r.level)}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-wolf-400">Limite diário</span>
        <span className="text-right font-mono">{money(r.dailyLossLimit)}</span>
        <span className="text-wolf-400">Disponível hoje</span>
        <span className="text-right font-mono">{money(r.dailyLossRemaining)}</span>
      </div>
      {bar(r.dailyUsedPct, r.level)}
      {r.highWaterMark != null && (
        <p className="mt-2 text-[10px] text-wolf-500">
          Máximo observado: {money(r.highWaterMark)} {r.trackingSince && `(acompanhando desde ${new Date(r.trackingSince).toLocaleString('pt-BR')})`}
        </p>
      )}
      {r.notes.map((n) => (
        <p key={n} className="mt-1 text-[10px] text-wolf-400">
          {n}
        </p>
      ))}
    </section>
  );
}
