import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE, EMPTY_RISK_STATE, deskStatus, evaluateRisk, type RiskRule } from '@bw/shared';

const base = { startingBalance: 50000, totalToday: 0, now: Date.parse('2026-10-26T15:00:00Z'), fresh: true };
const rule = (r: Partial<RiskRule>): RiskRule => ({ ...DEFAULT_RULE, ...r });

describe('evaluateRisk', () => {
  it('sem regra → nível desconhecido e nada inventado', () => {
    const { view } = evaluateRisk({ ...base, rule: rule({}), state: EMPTY_RISK_STATE, balance: 50000, equity: 50000 });
    expect(view.level).toBe('unknown');
    expect(view.liquidationThreshold).toBeNull();
    expect(view.drawdownRemaining).toBeNull();
  });

  it('estático: limite = saldo inicial − DD', () => {
    const { view } = evaluateRisk({ ...base, rule: rule({ type: 'static', maxDrawdown: 2000 }), state: EMPTY_RISK_STATE, balance: 49000, equity: 48800 });
    expect(view.liquidationThreshold).toBe(48000);
    expect(view.drawdownRemaining).toBe(800);
    expect(view.level).toBe('ok');
    expect(view.source).toBe('computed');
  });

  it('trailing intraday sobe com o pico de equity e para em saldo inicial + offset', () => {
    const r = rule({ type: 'trailing_intraday', maxDrawdown: 2500, trailStopOffset: 100 });
    let state = EMPTY_RISK_STATE;
    let out = evaluateRisk({ ...base, rule: r, state, balance: 50000, equity: 51000 });
    state = out.state;
    expect(out.view.highWaterMark).toBe(51000);
    expect(out.view.liquidationThreshold).toBe(48500);
    // Equity cai: limite NÃO desce
    out = evaluateRisk({ ...base, rule: r, state, balance: 50000, equity: 49000 });
    state = out.state;
    expect(out.view.liquidationThreshold).toBe(48500);
    expect(out.view.drawdownRemaining).toBe(500);
    expect(out.view.level).toBe('warn'); // 80% consumido ≥ 75%
    // Pico grande: o limite trava em 50.100
    out = evaluateRisk({ ...base, rule: r, state, balance: 53000, equity: 54000 });
    expect(out.view.liquidationThreshold).toBe(50100);
  });

  it('dados desatualizados não movem o high-water mark', () => {
    const r = rule({ type: 'trailing_intraday', maxDrawdown: 2500 });
    const out = evaluateRisk({ ...base, fresh: false, rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 60000, equity: 60000 });
    expect(out.state.highWaterMark).toBe(50000);
  });

  it('limite manual (do dashboard da prop) nunca é rebaixado pelo cálculo local', () => {
    const r = rule({ type: 'trailing_intraday', maxDrawdown: 2500, manualThreshold: 49200 });
    const out = evaluateRisk({ ...base, rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 50000, equity: 50000 });
    expect(out.view.liquidationThreshold).toBe(49200);
    expect(out.view.source).toBe('manual');
  });

  it('limite manual semeia o high-water mark quando não há estado', () => {
    const r = rule({ type: 'trailing_intraday', maxDrawdown: 2500, manualThreshold: 49200 });
    const out = evaluateRisk({ ...base, rule: r, state: EMPTY_RISK_STATE, balance: 51000, equity: 51000 });
    expect(out.state.highWaterMark).toBe(51700);
    expect(out.view.liquidationThreshold).toBe(49200);
  });

  it('breach quando equity ≤ limite', () => {
    const r = rule({ type: 'static', maxDrawdown: 2000 });
    const out = evaluateRisk({ ...base, rule: r, state: EMPTY_RISK_STATE, balance: 48000, equity: 47990 });
    expect(out.view.level).toBe('breach');
  });

  it('perda diária usa P&L total do dia', () => {
    const r = rule({ type: 'none', dailyLossLimit: 1000 });
    expect(evaluateRisk({ ...base, rule: r, state: EMPTY_RISK_STATE, balance: 50000, equity: 50000, totalToday: -800 }).view.level).toBe('warn');
    const b = evaluateRisk({ ...base, rule: r, state: EMPTY_RISK_STATE, balance: 50000, equity: 50000, totalToday: -1000 }).view;
    expect(b.level).toBe('breach');
    expect(b.dailyLossRemaining).toBe(0);
  });

  describe('trailing EOD', () => {
    const r = rule({ type: 'trailing_eod', maxDrawdown: 2000, eodTime: '17:00', eodTimeZone: 'America/New_York' });
    const at = (iso: string) => Date.parse(iso);
    it('atualiza no fechamento (dentro da janela de 60 min)', () => {
      const out = evaluateRisk({ ...base, now: at('2026-10-26T21:10:00Z'), rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 51000, equity: 51200 });
      expect(out.state.highWaterMark).toBe(51000);
      expect(out.state.lastEodDate).toBe('2026-10-26');
    });
    it('não atualiza durante o dia (intraday)', () => {
      const out = evaluateRisk({ ...base, now: at('2026-10-26T15:00:00Z'), rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 51000, equity: 52000 });
      expect(out.state.highWaterMark).toBe(50000);
    });
    it('app aberto horas depois do fechamento não usa saldo da sessão seguinte', () => {
      const out = evaluateRisk({ ...base, now: at('2026-10-27T01:30:00Z'), rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 51000, equity: 51000 });
      expect(out.state.highWaterMark).toBe(50000);
    });
    it('aplica uma única vez por dia', () => {
      const s1 = evaluateRisk({ ...base, now: at('2026-10-26T21:05:00Z'), rule: r, state: { ...EMPTY_RISK_STATE, highWaterMark: 50000 }, balance: 51000, equity: 51000 }).state;
      const s2 = evaluateRisk({ ...base, now: at('2026-10-26T21:20:00Z'), rule: r, state: s1, balance: 52000, equity: 52000 }).state;
      expect(s2.highWaterMark).toBe(51000);
    });
  });
});

describe('deskStatus — prioridade das cores', () => {
  const ok = { fresh: true, connStatus: 'connected' as const, totalToday: 100, equity: 50100, balance: 50000 };
  it('desconectada vence tudo (cinza)', () => expect(deskStatus({ ...ok, connStatus: 'connection_lost', riskLevel: 'breach' })).toBe('offline'));
  it('desatualizada é cinza', () => expect(deskStatus({ ...ok, fresh: false, riskLevel: 'ok' })).toBe('stale'));
  it('risco vence lucro', () => expect(deskStatus({ ...ok, riskLevel: 'warn' })).toBe('risk'));
  it('limite atingido vence lucro', () => expect(deskStatus({ ...ok, riskLevel: 'breach' })).toBe('breach'));
  it('lucro / prejuízo / zerada', () => {
    expect(deskStatus({ ...ok, riskLevel: 'ok' })).toBe('profit');
    expect(deskStatus({ ...ok, totalToday: -1, riskLevel: 'ok' })).toBe('loss');
    expect(deskStatus({ ...ok, totalToday: 0, riskLevel: 'ok' })).toBe('flat');
  });
  it('sem P&L informado → sem dados (não finge zero)', () => expect(deskStatus({ ...ok, totalToday: null, riskLevel: 'unknown' })).toBe('nodata'));
});
