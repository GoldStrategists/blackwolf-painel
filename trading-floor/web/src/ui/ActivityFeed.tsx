import { useMemo, useState } from 'react';
import type { ActivityEvent } from '@bw/shared';
import { useFloor } from '../lib/store';
import { time } from '../lib/format';

type Filter = 'all' | 'execution' | 'robot' | 'alert';

export function EventRow({ e, showAccount = true }: { e: ActivityEvent; showAccount?: boolean }) {
  const accountName = useFloor((s) => (e.accountId ? s.accounts[e.accountId]?.displayName ?? e.accountId.split(':').slice(1).join(':') : null));
  const select = useFloor((s) => s.select);
  const tag =
    e.kind === 'execution' ? (
      <span className="rounded bg-pos/15 px-1.5 py-0.5 text-[9px] font-black text-pos">EXECUÇÃO CONFIRMADA</span>
    ) : e.kind === 'robot' ? (
      e.correlatedExecutionId ? (
        <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[9px] font-black text-brand-glow" title="Evento do robô com execução real correspondente na conta">ROBÔ · ✓ CONFERE C/ EXECUÇÃO</span>
      ) : (
        <span className="rounded bg-wolf-700 px-1.5 py-0.5 text-[9px] font-black text-wolf-300" title="Informado pelo robô — ainda não confirmado pela conta">ROBÔ · INFORMATIVO</span>
      )
    ) : e.kind === 'alert' ? (
      <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[9px] font-black text-warn">ALERTA</span>
    ) : (
      <span className="rounded bg-wolf-700 px-1.5 py-0.5 text-[9px] font-black text-wolf-400">SISTEMA</span>
    );
  const color = e.severity === 'error' ? 'text-neg' : e.severity === 'warning' ? 'text-warn' : e.severity === 'success' ? 'text-wolf-200' : 'text-wolf-300';
  return (
    <div className="border-b border-wolf-800 px-3 py-2 text-xs last:border-0">
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-wolf-500">{time(e.ts)}</span>
        {tag}
        {showAccount && accountName && (
          <button className="truncate text-[10px] font-semibold text-brand-glow hover:underline" onClick={() => e.accountId && select(e.accountId)}>
            {accountName}
          </button>
        )}
      </div>
      <div className={color}>{e.message}</div>
    </div>
  );
}

export function ActivityFeed() {
  const open = useFloor((s) => s.feedOpen);
  const events = useFloor((s) => s.events);
  const drawer = useFloor((s) => s.selectedId);
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMemo(() => events.filter((e) => filter === 'all' || e.kind === filter || (filter === 'alert' && e.severity === 'error')).slice(0, 120), [events, filter]);
  if (!open) return null;
  const filters: [Filter, string][] = [
    ['all', 'Tudo'],
    ['execution', 'Execuções'],
    ['robot', 'Robô'],
    ['alert', 'Alertas'],
  ];
  return (
    <div className={`pointer-events-auto glass absolute right-3 top-[92px] z-10 flex max-h-[calc(100%-230px)] w-[340px] flex-col rounded-xl ${drawer ? 'hidden min-[1900px]:flex min-[1900px]:right-[452px]' : ''}`}>
      <div className="flex items-center justify-between border-b border-wolf-700 px-3 py-2">
        <div className="text-xs font-black tracking-wider text-wolf-200">ATIVIDADES</div>
        <div className="flex gap-1">
          {filters.map(([f, l]) => (
            <button key={f} className={`btn px-2 py-0.5 text-[10px] ${filter === f ? 'btn-on' : ''}`} onClick={() => setFilter(f)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? <div className="p-4 text-xs text-wolf-500">Nenhum evento.</div> : list.map((e) => <EventRow key={e.id} e={e} />)}
      </div>
      <div className="border-t border-wolf-700 px-3 py-1.5 text-[10px] text-wolf-500">Sinais e eventos do robô são informativos. Só “execução confirmada” veio da conta.</div>
    </div>
  );
}
