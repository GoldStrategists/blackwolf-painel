import type { AccountView, ConnStatus, DeskStatus, RiskRule, RiskState, RiskView } from './types.js';

export const DEFAULT_RULE: RiskRule = {
  type: 'none',
  maxDrawdown: null,
  trailStopOffset: null,
  dailyLossLimit: null,
  warnAtPct: 0.75,
  manualThreshold: null,
  manualThresholdSetAt: null,
  eodTime: '17:00',
  eodTimeZone: 'America/New_York',
};

export const EMPTY_RISK_STATE: RiskState = { highWaterMark: null, trackingSince: null, lastEodDate: null };

/**
 * Modelos de plano para preencher o formulário. Os números de prop firm mudam com frequência
 * (a Apex trocou os produtos em mar/2026 e contas legadas seguem regras antigas), por isso
 * TODOS são marcados como "confira" e são editáveis por conta.
 */
export interface PlanTemplate {
  id: string;
  label: string;
  nominalSize: number;
  rule: Partial<RiskRule>;
  warning: string;
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'custom',
    label: 'Personalizado',
    nominalSize: 50000,
    rule: { type: 'none' },
    warning: 'Defina as regras manualmente.',
  },
  {
    id: 'trailing-intraday-50k',
    label: 'Trailing intraday 50K (modelo)',
    nominalSize: 50000,
    rule: { type: 'trailing_intraday', maxDrawdown: 2500, trailStopOffset: 100 },
    warning: 'Modelo genérico. Confira drawdown e ponto de parada no dashboard da sua prop firm.',
  },
  {
    id: 'trailing-eod-50k',
    label: 'Trailing EOD 50K (modelo)',
    nominalSize: 50000,
    rule: { type: 'trailing_eod', maxDrawdown: 2000, trailStopOffset: 100 },
    warning: 'Modelo genérico. O horário de fechamento e o valor variam por empresa/plano.',
  },
  {
    id: 'static-50k',
    label: 'Drawdown estático 50K (modelo)',
    nominalSize: 50000,
    rule: { type: 'static', maxDrawdown: 2000, trailStopOffset: null },
    warning: 'Modelo genérico. Confira os valores do seu plano.',
  },
];

const round2 = (v: number) => Math.round(v * 100) / 100;
export const EOD_WINDOW_MIN = 60;

/** Data YYYY-MM-DD e minutos do dia em um fuso IANA. */
export function zonedDayAndMinute(ts: number, timeZone: string): { day: string; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ts));
  } catch {
    return zonedDayAndMinute(ts, 'UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export interface RiskInput {
  rule: RiskRule;
  state: RiskState;
  startingBalance: number | null;
  balance: number | null;
  equity: number | null;
  totalToday: number | null;
  now: number;
  /** Só atualiza o high-water mark com dados atuais (nunca com dados velhos). */
  fresh: boolean;
}

/**
 * Calcula o risco da conta e devolve o novo estado (high-water mark).
 * Função pura: não persiste nada; quem chama decide salvar o novo estado.
 */
export function evaluateRisk(input: RiskInput): { view: RiskView; state: RiskState } {
  const { rule, startingBalance, balance, equity, totalToday, now, fresh } = input;
  const state: RiskState = { ...input.state };
  const notes: string[] = [];
  const value = equity ?? balance;

  let threshold: number | null = null;
  let source: RiskView['source'] = 'none';
  const maxDD = rule.maxDrawdown;

  if (rule.type !== 'none' && maxDD != null) {
    const cap = startingBalance != null && rule.trailStopOffset != null ? startingBalance + rule.trailStopOffset : null;

    if (rule.type === 'static') {
      if (rule.manualThreshold != null) {
        threshold = rule.manualThreshold;
        source = 'manual';
      } else if (startingBalance != null) {
        threshold = startingBalance - maxDD;
        source = 'computed';
      } else notes.push('Informe o saldo inicial para calcular o limite estático.');
    } else {
      // Semente do high-water mark: valor manual informado > saldo inicial > primeiro valor visto.
      if (state.highWaterMark == null) {
        if (rule.manualThreshold != null) state.highWaterMark = rule.manualThreshold + maxDD;
        else if (startingBalance != null) state.highWaterMark = startingBalance;
        else if (fresh && value != null) state.highWaterMark = value;
        if (state.highWaterMark != null) state.trackingSince = new Date(now).toISOString();
      }

      if (fresh && rule.type === 'trailing_intraday' && equity != null && state.highWaterMark != null) {
        if (equity > state.highWaterMark) state.highWaterMark = equity;
      }

      if (fresh && rule.type === 'trailing_eod' && balance != null && state.highWaterMark != null) {
        const [h, m] = rule.eodTime.split(':').map(Number);
        const { day, minute } = zonedDayAndMinute(now, rule.eodTimeZone);
        const eodMinute = (h ?? 17) * 60 + (m ?? 0);
        // Só aceita o saldo como "fechamento" se o app estava rodando perto do EOD (janela de
        // 60 min). Se o app abriu depois, aquele dia fica sem atualização — nunca usamos um
        // saldo da sessão seguinte como se fosse o fechamento.
        if (minute >= eodMinute && minute < eodMinute + EOD_WINDOW_MIN && state.lastEodDate !== day) {
          if (balance > state.highWaterMark) state.highWaterMark = balance;
          state.lastEodDate = day;
        }
      }

      if (state.highWaterMark != null) {
        threshold = state.highWaterMark - maxDD;
        if (cap != null && threshold > cap) threshold = cap;
        // Um limite informado manualmente nunca é rebaixado pelo cálculo local.
        if (rule.manualThreshold != null && rule.manualThreshold > threshold) threshold = rule.manualThreshold;
        source = rule.manualThreshold != null ? 'manual' : 'computed';
      }
      if (rule.manualThreshold == null) {
        notes.push('Trailing calculado localmente a partir do que o app observou. Informe o limite atual da prop firm para maior precisão.');
      }
      if (rule.type === 'trailing_eod')
        notes.push(`EOD considerado às ${rule.eodTime} (${rule.eodTimeZone}); dias em que o app não estava aberto até ${EOD_WINDOW_MIN} min após o fechamento não atualizam o trailing.`);
    }
  } else if (rule.type !== 'none') {
    notes.push('Informe o drawdown máximo do plano.');
  }

  const drawdownRemaining = threshold != null && value != null ? round2(value - threshold) : null;
  const drawdownUsedPct =
    drawdownRemaining != null && maxDD ? clamp01(1 - drawdownRemaining / maxDD) : null;

  const daily = rule.dailyLossLimit;
  const dailyLossRemaining = daily != null && totalToday != null ? round2(daily + totalToday) : null;
  const dailyUsedPct = daily != null && totalToday != null ? clamp01(-totalToday / daily) : null;

  let level: RiskView['level'] = 'unknown';
  const hasAny = drawdownRemaining != null || dailyLossRemaining != null;
  if (hasAny) {
    level = 'ok';
    const warn = rule.warnAtPct;
    if ((drawdownUsedPct != null && drawdownUsedPct >= warn) || (dailyUsedPct != null && dailyUsedPct >= warn)) level = 'warn';
    if ((drawdownRemaining != null && drawdownRemaining <= 0) || (dailyLossRemaining != null && dailyLossRemaining <= 0)) level = 'breach';
  }

  return {
    state,
    view: {
      ruleType: rule.type,
      maxDrawdown: maxDD,
      liquidationThreshold: threshold != null ? round2(threshold) : null,
      drawdownRemaining,
      drawdownUsedPct,
      dailyLossLimit: daily,
      dailyLossRemaining,
      dailyUsedPct,
      level,
      source,
      highWaterMark: state.highWaterMark != null ? round2(state.highWaterMark) : null,
      trackingSince: state.trackingSince,
      notes,
    },
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Status visual da mesa. Prioridade: sem dados confiáveis (cinza) > risco (vermelho/amarelo) > resultado.
 */
export function deskStatus(a: Pick<AccountView, 'fresh' | 'connStatus' | 'totalToday' | 'equity' | 'balance'> & { riskLevel: RiskView['level'] }): DeskStatus {
  if (a.connStatus !== 'connected') return 'offline';
  if (!a.fresh) return 'stale';
  if (a.totalToday == null && a.equity == null && a.balance == null) return 'nodata';
  if (a.riskLevel === 'breach') return 'breach';
  if (a.riskLevel === 'warn') return 'risk';
  if (a.totalToday == null) return 'nodata';
  if (a.totalToday > 0.005) return 'profit';
  if (a.totalToday < -0.005) return 'loss';
  return 'flat';
}

export const isConnected = (s: ConnStatus) => s === 'connected';
