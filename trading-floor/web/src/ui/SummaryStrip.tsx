import { useFloor, isServerLive } from '../lib/store';
import { pnlClass } from '../lib/colors';
import { compactMoney, money } from '../lib/format';
import { useNow } from './useNow';

/** Versão 2D do telão (legível em qualquer ângulo de câmera). */
export function SummaryStrip() {
  const s = useFloor((st) => st.summary);
  const ws = useFloor((st) => st.ws);
  const lastMessageAt = useFloor((st) => st.lastMessageAt);
  const now = useNow(1000);
  if (!s) return null;
  const live = isServerLive({ ws, lastMessageAt }, now);
  const tiles: { label: string; value: string; cls?: string; hint?: string }[] = [
    { label: 'P&L total hoje', value: money(s.totalToday, { sign: true }), cls: pnlClass(s.totalToday), hint: 'Realizado + não realizado das contas atualizadas' },
    { label: 'Realizado', value: money(s.realizedToday, { sign: true }), cls: pnlClass(s.realizedToday) },
    { label: 'Não realizado', value: money(s.unrealized, { sign: true }), cls: pnlClass(s.unrealized) },
    { label: 'Acumulado', value: money(s.cumulativePnl, { sign: true }), cls: pnlClass(s.cumulativePnl), hint: 'Saldo − saldo inicial configurado' },
    { label: 'Capital nominal*', value: compactMoney(s.nominalCapital), hint: 'Soma dos tamanhos das contas. NÃO é patrimônio, saldo próprio nem valor sacável.' },
    { label: 'Contas', value: `${s.accountsConnected}/${s.accountsTotal} on`, hint: `${s.accountsPositive} positivas · ${s.accountsNegative} negativas · ${s.accountsFlat} zeradas` },
    { label: '+ / −', value: `${s.accountsPositive} / ${s.accountsNegative}` },
    { label: 'Posições', value: `${s.openPositions} · ${s.openContracts} ctr` },
    {
      label: 'Risco',
      value: `${s.riskBreach} lim · ${s.riskWarn} alerta`,
      cls: s.riskBreach ? 'text-neg' : s.riskWarn ? 'text-warn' : 'text-pos',
      hint: `${s.riskUnknown} conta(s) sem risco calculável. Menor drawdown disponível: ${money(s.minDrawdownRemaining)}`,
    },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3">
      <div className={`pointer-events-auto glass mx-auto flex max-w-[1400px] flex-wrap items-stretch gap-px overflow-hidden rounded-xl ${live ? '' : 'opacity-60 grayscale'}`}>
        {tiles.map((t) => (
          <div key={t.label} className="min-w-[110px] flex-1 bg-wolf-900/60 px-3 py-2" title={t.hint}>
            <div className="kpi-label">{t.label}</div>
            <div className={`kpi-value ${t.cls ?? 'text-wolf-200'}`}>{t.value}</div>
          </div>
        ))}
      </div>
      <div className="pointer-events-auto mx-auto mt-1 max-w-[1400px] text-center text-[10px] text-wolf-500">
        *Capital nominal é a soma dos tamanhos das contas (ex.: 20 × US$ 50 mil) — não representa dinheiro próprio, patrimônio líquido ou capital sacável.
        {s.accountsExcludedStale > 0 && <span className="text-warn"> · {s.accountsExcludedStale} conta(s) fora dos totais por estarem offline/desatualizadas.</span>}
      </div>
    </div>
  );
}
