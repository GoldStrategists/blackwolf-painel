const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const NA = '—';

export function money(v: number | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const s = opts.compact && Math.abs(v) >= 10000 ? usd0.format(v) : usd.format(v);
  if (opts.sign && v > 0) return `+${s}`;
  return s;
}

export function compactMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}US$ ${(a / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (a >= 10_000) return `${sign}US$ ${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return money(v);
}

export const number = (v: number | null | undefined) => (v == null ? NA : num.format(v));
export const pct = (v: number | null | undefined) => (v == null ? NA : `${Math.round(v * 100)}%`);

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'nunca';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const time = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dateTime = (ts: number) =>
  new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
