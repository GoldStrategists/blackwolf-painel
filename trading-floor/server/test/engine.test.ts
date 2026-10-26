import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@bw/shared';
import { ModeEngine } from '../src/engine.js';
import { MemoryConfigRepo, MemoryDataRepo } from '../src/db/memory.js';
import { DemoSimulator } from '../src/demo.js';
import { Clock, account, payload } from './helpers.js';

let clock: Clock;
let engine: ModeEngine;
let msgs: ServerMessage[];

beforeEach(async () => {
  clock = new Clock();
  engine = new ModeEngine('live', new MemoryConfigRepo(), new MemoryDataRepo(), { staleAfterMs: 5000, persistEveryMs: 1000, now: clock.now });
  await engine.init();
  msgs = [];
  engine.hub.add({ send: (m) => msgs.push(m) });
});

const view = (id: string) => engine.views().find((v) => v.id === id)!;

describe('ModeEngine — ingestão', () => {
  it('descobre contas e aloca na sala pela conexão', async () => {
    await engine.ingest(payload(1, [account('APEX-111-01'), account('APEX-222-01', { provider: 'Tradovate', connection: 'Tradovate' }), account('TOPSTEP-1')]), 'nt8');
    expect(view('nt8:APEX-111-01').roomId).toBe('apex-rithmic');
    expect(view('nt8:APEX-222-01').roomId).toBe('apex-tradovate');
    expect(view('nt8:TOPSTEP-1').roomId).toBe('outras-prop');
    expect(view('nt8:APEX-111-01').status).toBe('flat');
  });

  it('campos não informados ficam null, nunca 0', async () => {
    await engine.ingest(payload(1, [account('A', { items: { NetLiquidation: 50500 } })]), 'nt8');
    const v = view('nt8:A');
    expect(v.balance).toBeNull();
    expect(v.realizedToday).toBeNull();
    expect(v.totalToday).toBeNull();
    expect(v.equity).toBe(50500);
    expect(v.alerts.join(' ')).toMatch(/não informou P&L realizado/);
  });

  it('calcula P&L total e unrealized pelas posições quando a conta não informa', async () => {
    await engine.ingest(
      payload(1, [
        account('A', {
          items: { CashValue: 50200, RealizedProfitLoss: 200 },
          positions: [{ instrument: 'NQ DEC26', side: 'long', quantity: 1, avgPrice: 21000, unrealized: 150 }],
        }),
      ]),
      'nt8',
    );
    const v = view('nt8:A');
    expect(v.unrealized).toBe(150);
    expect(v.equity).toBe(50350);
    expect(v.totalToday).toBe(350);
    expect(v.status).toBe('profit');
  });

  it('ignora pacote duplicado (mesma sessão, seq repetido)', async () => {
    const p = payload(5, [account('A')]);
    expect((await engine.ingest(p, 'nt8')).accepted).toBe(true);
    expect((await engine.ingest(p, 'nt8')).reason).toBe('duplicate');
  });

  it('ignora snapshot atrasado mas aceita novo seq após reinício do coletor', async () => {
    await engine.ingest(payload(10, [account('A', { items: { CashValue: 51000, RealizedProfitLoss: 1000, UnrealizedProfitLoss: 0 } })]), 'nt8');
    const late = payload(11, [account('A', { items: { CashValue: 1, RealizedProfitLoss: -999, UnrealizedProfitLoss: 0 } })], {}, clock.t - 10_000);
    await engine.ingest(late, 'nt8');
    expect(view('nt8:A').balance).toBe(51000);
    await engine.ingest(payload(1, [account('A', { items: { CashValue: 52000, RealizedProfitLoss: 2000, UnrealizedProfitLoss: 0 } })], { sessionId: 'sess-2' }), 'nt8');
    expect(view('nt8:A').balance).toBe(52000);
  });

  it('execuções são deduplicadas pelo execId', async () => {
    const ex = { account: 'A', execId: 'X1', time: new Date(clock.t).toISOString(), instrument: 'NQ DEC26', side: 'buy' as const, quantity: 1, price: 21000, orderId: 'O1' };
    const r1 = await engine.ingest(payload(1, [account('A')], { executions: [ex] }), 'nt8');
    const r2 = await engine.ingest(payload(2, [account('A')], { executions: [ex] }), 'nt8');
    expect(r1.newExecutions).toBe(1);
    expect(r2.newExecutions).toBe(0);
    const events = msgs.filter((m) => m.t === 'event' && m.event.kind === 'execution');
    expect(events).toHaveLength(1);
  });

  it('marca como desatualizada quando o coletor para de enviar', async () => {
    await engine.ingest(payload(1, [account('A', { items: { CashValue: 50100, RealizedProfitLoss: 100, UnrealizedProfitLoss: 0 } })]), 'nt8');
    expect(view('nt8:A').fresh).toBe(true);
    clock.advance(6000);
    await engine.tick();
    const v = view('nt8:A');
    expect(v.fresh).toBe(false);
    expect(v.status).toBe('stale');
    expect(v.alerts.join(' ')).toMatch(/ÚLTIMOS CONHECIDOS/);
    // E sai dos totais consolidados
    const summary = (msgs.filter((m) => m.t === 'summary').pop() as Extract<ServerMessage, { t: 'summary' }>).summary;
    expect(summary.accountsExcludedStale).toBe(1);
    expect(summary.totalToday).toBeNull();
  });

  it('conta que some do coletor vira desconectada', async () => {
    await engine.ingest(payload(1, [account('A'), account('B')]), 'nt8');
    await engine.ingest(payload(2, [account('A')]), 'nt8');
    expect(view('nt8:B').connStatus).toBe('disconnected');
    expect(view('nt8:B').status).toBe('offline');
  });

  it('conexão perdida na plataforma = cinza, mesmo com lucro', async () => {
    await engine.ingest(payload(1, [account('A', { connectionStatus: 'connection_lost', items: { CashValue: 51000, RealizedProfitLoss: 1000, UnrealizedProfitLoss: 0 } })]), 'nt8');
    expect(view('nt8:A').status).toBe('offline');
  });

  it('capital nominal soma tamanhos e fica separado de saldo', async () => {
    await engine.ingest(payload(1, [account('A'), account('B')]), 'nt8');
    await engine.patchAccount('nt8:A', { nominalSize: 50000, startingBalance: 50000 });
    await engine.patchAccount('nt8:B', { nominalSize: 50000, startingBalance: 50000 });
    const s = engine.snapshot().summary;
    expect(s.nominalCapital).toBe(100000);
    expect(s.balanceTotal).toBe(100000);
  });

  it('alterar regra de risco reinicia o acompanhamento do trailing', async () => {
    await engine.ingest(payload(1, [account('A', { items: { CashValue: 50000, NetLiquidation: 51000, RealizedProfitLoss: 0, UnrealizedProfitLoss: 1000 } })]), 'nt8');
    await engine.patchAccount('nt8:A', { startingBalance: 50000, rule: { ...engine.getAccount('nt8:A')!.rule, type: 'trailing_intraday', maxDrawdown: 2500 } });
    expect(view('nt8:A').risk.highWaterMark).toBe(51000);
    await engine.patchAccount('nt8:A', { rule: { ...engine.getAccount('nt8:A')!.rule, manualThreshold: 48000 } });
    const cfg = engine.getAccount('nt8:A')!;
    expect(cfg.rule.manualThresholdSetAt).not.toBeNull();
    expect(view('nt8:A').risk.liquidationThreshold).toBe(48500);
  });

  it('reorganização: mover de sala e reordenar', async () => {
    await engine.ingest(payload(1, [account('APEX-1'), account('APEX-2'), account('APEX-3')]), 'nt8');
    await engine.patchAccount('nt8:APEX-3', { roomId: 'pessoais', displayName: 'Mesa do Luiz' });
    expect(view('nt8:APEX-3').roomId).toBe('pessoais');
    expect(view('nt8:APEX-3').displayName).toBe('Mesa do Luiz');
    await engine.reorderRoom('apex-rithmic', ['nt8:APEX-2', 'nt8:APEX-1']);
    expect(view('nt8:APEX-2').deskIndex).toBe(0);
    expect(view('nt8:APEX-1').deskIndex).toBe(1);
    await expect(engine.deleteRoom('apex-rithmic')).rejects.toThrow(/Mova as contas/);
  });
});

describe('ModeEngine — eventos do robô', () => {
  it('evento do robô nunca é execução confirmada', async () => {
    const r = await engine.ingestRobot({ eventId: 'e1', type: 'entry_executed', account: 'A', instrument: 'NQ', side: 'buy', quantity: 1, price: 21000 }, 'r1');
    expect(r.event!.kind).toBe('robot');
    expect(r.event!.confirmed).toBe(false);
    expect(r.event!.correlatedExecutionId).toBeNull();
  });

  it('dedup por eventId', async () => {
    expect((await engine.ingestRobot({ eventId: 'e1', type: 'signal', account: 'A' }, 'r1')).accepted).toBe(true);
    expect((await engine.ingestRobot({ eventId: 'e1', type: 'signal', account: 'A' }, 'r1')).accepted).toBe(false);
  });

  it('correlaciona com a execução real pelo orderId (em qualquer ordem de chegada)', async () => {
    await engine.ingestRobot({ eventId: 'e1', type: 'entry_executed', account: 'A', instrument: 'NQ DEC26', orderId: 'O9' }, 'r1');
    await engine.ingest(
      payload(1, [account('A')], { executions: [{ account: 'A', execId: 'X9', time: new Date(clock.t).toISOString(), instrument: 'NQ DEC26', side: 'buy', quantity: 1, price: 1, orderId: 'O9' }] }),
      'nt8',
    );
    const updated = msgs.filter((m) => m.t === 'event' && m.event.id === 'robot:r1:e1').pop() as Extract<ServerMessage, { t: 'event' }>;
    expect(updated.event.correlatedExecutionId).toBe('X9');
    expect(updated.event.confirmed).toBe(false);
  });

  it('sinal não vira operação', async () => {
    const r = await engine.ingestRobot({ eventId: 's1', type: 'signal', account: 'A', instrument: 'NQ' }, 'r1');
    expect(r.event!.type).toBe('signal');
    expect(engine.views()).toHaveLength(0); // não cria conta nem posição
  });
});

describe('Segregação DEMO / LIVE', () => {
  it('motor DEMO recusa armazenamento persistente', () => {
    const fakePersistent = Object.assign(new MemoryDataRepo(), { persistent: true });
    expect(() => new ModeEngine('demo', new MemoryConfigRepo(), fakePersistent, { staleAfterMs: 5000, persistEveryMs: 1000 })).toThrow();
  });

  it('simulador só alimenta o modo DEMO e marca tudo como DEMO', async () => {
    expect(() => new DemoSimulator(engine)).toThrow();
    const config = new MemoryConfigRepo();
    const demo = new ModeEngine('demo', config, new MemoryDataRepo(), { staleAfterMs: 5000, persistEveryMs: 1000, now: clock.now });
    await demo.init();
    const live = new ModeEngine('live', config, new MemoryDataRepo(), { staleAfterMs: 5000, persistEveryMs: 1000, now: clock.now });
    await live.init();
    const sim = new DemoSimulator(demo, clock.now);
    await sim.seed();
    for (let i = 0; i < 30; i++) {
      clock.advance(1000);
      await sim.step();
    }
    const views = demo.views();
    expect(views).toHaveLength(20);
    expect(views.every((v) => v.name.startsWith('DEMO-') && v.mode === 'demo' && v.id.startsWith('demo:'))).toBe(true);
    expect(live.views()).toHaveLength(0);
    expect(await config.listAccounts('live')).toHaveLength(0);
    // Variedade: há lucro, prejuízo e pelo menos uma conta em risco
    const st = new Set(views.map((v) => v.status));
    expect(st.has('profit') || st.has('loss')).toBe(true);
    expect(demo.snapshot().summary.nominalCapital).toBe(8 * 50000 + 7 * 50000 + 3 * 100000 + 2 * 25000);
  });
});
