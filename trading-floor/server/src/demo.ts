import type { CollectorAccount, CollectorExecution, CollectorPayload, RiskRule } from '@bw/shared';
import { DEFAULT_RULE } from '@bw/shared';
import type { ModeEngine } from './engine.js';
import { randomId } from './security.js';

/**
 * Simulador do modo DEMO. Gera dados FICTÍCIOS no mesmo formato do coletor NT8 e os
 * injeta no motor do modo 'demo' — nunca no 'live'. Todas as contas têm prefixo "DEMO-".
 */

interface Instrument {
  symbol: string;
  price: number;
  tick: number;
  pointValue: number;
  vol: number;
}

const INSTRUMENTS: Instrument[] = [
  { symbol: 'MNQ DEC26', price: 21450, tick: 0.25, pointValue: 2, vol: 2.2 },
  { symbol: 'NQ DEC26', price: 21450, tick: 0.25, pointValue: 20, vol: 2.2 },
  { symbol: 'MES DEC26', price: 6050, tick: 0.25, pointValue: 5, vol: 0.7 },
  { symbol: 'ES DEC26', price: 6050, tick: 0.25, pointValue: 50, vol: 0.7 },
  { symbol: 'CL DEC26', price: 71.2, tick: 0.01, pointValue: 1000, vol: 0.02 },
  { symbol: 'GC DEC26', price: 2650, tick: 0.1, pointValue: 100, vol: 0.6 },
];

interface SimPosition {
  inst: Instrument;
  side: 'long' | 'short';
  qty: number;
  avg: number;
  openedAt: number;
  orderId: string;
  stop: number;
  target: number;
}

interface SimAccount {
  name: string;
  roomId: string;
  provider: string;
  connection: string;
  firm: string;
  plan: string;
  nominal: number;
  startingBalance: number;
  /** Saldo no início do dia (simulado). */
  sodBalance: number;
  realizedToday: number;
  positions: SimPosition[];
  skill: number;
  aggressiveness: number;
  instruments: Instrument[];
  connected: boolean;
  reconnectAt: number;
  rule: Partial<RiskRule>;
  robot: boolean;
  hasRealized: boolean;
}

/** Gerador determinístico (semente fixa) para que o DEMO seja reproduzível. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROSTER: { room: string; provider: string; firm: string; count: number; nominal: number; plan: string }[] = [
  { room: 'apex-rithmic', provider: 'Rithmic', firm: 'Apex', count: 8, nominal: 50000, plan: 'DEMO 50K trailing intraday' },
  { room: 'apex-tradovate', provider: 'Tradovate', firm: 'Apex', count: 7, nominal: 50000, plan: 'DEMO 50K trailing EOD' },
  { room: 'outras-prop', provider: 'Rithmic', firm: 'Prop DEMO', count: 3, nominal: 100000, plan: 'DEMO 100K estático' },
  { room: 'pessoais', provider: 'Tradovate', firm: 'Pessoal', count: 2, nominal: 25000, plan: 'DEMO conta pessoal' },
];

export class DemoSimulator {
  private rnd = mulberry32(0xb1ac);
  private accounts: SimAccount[] = [];
  private seq = 0;
  private readonly sessionId = randomId();
  private pendingExecutions: CollectorExecution[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastRobotAt = 0;

  constructor(
    private readonly engine: ModeEngine,
    private readonly now: () => number = Date.now,
    /** Quantidade de contas fictícias (padrão 20; use 50/100+ para testar desempenho). */
    total = 20,
  ) {
    if (engine.mode !== 'demo') throw new Error('O simulador só pode alimentar o modo DEMO');
    const scale = Math.max(1, total) / 20;
    let n = 1;
    for (const group of ROSTER) {
      const count = Math.max(1, Math.round(group.count * scale));
      for (let i = 0; i < count; i++, n++) {
        const startingBalance = group.nominal;
        // Contas já com histórico: algumas positivas, outras negativas.
        const history = Math.round((this.rnd() - 0.4) * group.nominal * 0.05);
        const rule: Partial<RiskRule> =
          group.room === 'apex-rithmic'
            ? { type: 'trailing_intraday', maxDrawdown: 2500, trailStopOffset: 100, dailyLossLimit: null }
            : group.room === 'apex-tradovate'
              ? { type: 'trailing_eod', maxDrawdown: 2000, trailStopOffset: 100, dailyLossLimit: 1000 }
              : group.room === 'outras-prop'
                ? { type: 'static', maxDrawdown: 3000, trailStopOffset: null, dailyLossLimit: 1500 }
                : { type: 'none' };
        const prefix = group.firm === 'Apex' ? 'APEX' : group.firm === 'Pessoal' ? 'PESSOAL' : 'PROP';
        this.accounts.push({
          name: `DEMO-${prefix}-${String(n).padStart(total > 99 ? 3 : 2, '0')}`,
          roomId: group.room,
          provider: group.provider,
          connection: `DEMO ${group.provider}`,
          firm: group.firm,
          plan: group.plan,
          nominal: group.nominal,
          startingBalance,
          sodBalance: startingBalance + history,
          // Resultado do dia já em andamento, para a sala abrir com cores variadas.
          realizedToday: Math.round((this.rnd() - 0.42) * 900),
          positions: [],
          skill: 0.47 + this.rnd() * 0.1,
          aggressiveness: 0.3 + this.rnd() * 0.7,
          instruments: [INSTRUMENTS[Math.floor(this.rnd() * 2)]!, INSTRUMENTS[2 + Math.floor(this.rnd() * 4)]!],
          connected: true,
          reconnectAt: 0,
          rule,
          robot: this.rnd() < 0.6,
          hasRealized: true,
        });
      }
    }
    // Uma conta já começa perto do limite (para demonstrar o amarelo).
    const nearRisk = this.accounts[3];
    if (nearRisk) nearRisk.sodBalance = nearRisk.startingBalance - 1950;
    // Uma conta sem P&L realizado reportado (para demonstrar "indisponível").
    const partial = this.accounts[18];
    if (partial) partial.hasRealized = false;
  }

  /** Aplica configuração inicial (tamanho, regras) às contas DEMO na primeira execução. */
  async seed() {
    await this.engine.ingest(this.payload(), 'demo');
    for (const a of this.accounts) {
      const id = this.engine.accountId(a.name);
      const cfg = this.engine.getAccount(id);
      if (!cfg) continue;
      if (cfg.nominalSize == null) {
        await this.engine.patchAccount(id, {
          roomId: a.roomId,
          firm: a.firm,
          plan: a.plan,
          nominalSize: a.nominal,
          startingBalance: a.startingBalance,
          rule: { ...DEFAULT_RULE, ...a.rule, manualThreshold: null, manualThresholdSetAt: null },
        });
      }
    }
    await this.generateHistory();
  }

  private async generateHistory() {
    const now = this.now();
    const data = this.engine.data;
    for (const a of this.accounts) {
      const id = this.engine.accountId(a.name);
      // 45 dias de pontos (a cada 2h) até o saldo de início do dia.
      const days = 45;
      const steps = days * 12;
      // Ponte browniana: passeio aleatório que termina exatamente no saldo de início do dia.
      const walk: number[] = [0];
      for (let i = 1; i < steps; i++) walk.push(walk[i - 1]! + (this.rnd() - 0.5) * a.nominal * 0.004);
      const last = walk[steps - 1]!;
      for (let i = 0; i < steps; i++) {
        const ts = now - (steps - i) * 2 * 3600_000;
        const f = i / (steps - 1);
        const bal = a.startingBalance + (a.sodBalance - a.startingBalance) * f + walk[i]! - last * f;
        await data.insertEquityPoint(id, { ts, balance: round(bal), equity: round(bal), realized: null, unrealized: 0 });
      }
      // Execuções fictícias dos últimos dias.
      for (let k = 0; k < 14; k++) {
        const inst = a.instruments[k % a.instruments.length]!;
        const ts = now - Math.floor(this.rnd() * 10 * 86400_000);
        const price = roundTick(inst.price * (1 + (this.rnd() - 0.5) * 0.02), inst.tick);
        const orderId = `DEMO-ORD-${randomId()}`;
        await data.insertExecution({
          execId: `DEMO-EX-${randomId()}`,
          accountId: id,
          mode: 'demo',
          ts,
          instrument: inst.symbol,
          side: k % 2 === 0 ? 'buy' : 'sell',
          quantity: 1 + Math.floor(this.rnd() * 3),
          price,
          orderId,
        });
      }
    }
  }

  start(intervalMs = 1000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.step().catch(() => undefined), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async step() {
    const now = this.now();
    for (const inst of INSTRUMENTS) {
      const move = (this.rnd() - 0.5) * 2 * inst.vol + (this.rnd() < 0.02 ? (this.rnd() - 0.5) * inst.vol * 12 : 0);
      inst.price = Math.max(inst.tick, roundTick(inst.price + move, inst.tick));
    }
    for (const a of this.accounts) {
      // Quedas de conexão ocasionais (mostra o cinza/desatualizado).
      if (a.connected && this.rnd() < 0.0015) {
        a.connected = false;
        a.reconnectAt = now + 8000 + this.rnd() * 20000;
      } else if (!a.connected && now >= a.reconnectAt) a.connected = true;
      if (!a.connected) continue;
      this.tradeLogic(a, now);
    }
    await this.engine.ingest(this.payload(), 'demo');
  }

  private tradeLogic(a: SimAccount, now: number) {
    for (const p of [...a.positions]) {
      const px = p.inst.price;
      const hitStop = p.side === 'long' ? px <= p.stop : px >= p.stop;
      const hitTarget = p.side === 'long' ? px >= p.target : px <= p.target;
      const timeout = now - p.openedAt > 60_000 + this.rnd() * 120_000;
      if (hitStop || hitTarget || timeout) this.close(a, p, now, hitTarget ? 'take_profit' : hitStop ? 'stop_loss' : 'position_closed');
    }
    if (a.positions.length === 0 && this.rnd() < 0.02 * a.aggressiveness) {
      const inst = a.instruments[Math.floor(this.rnd() * a.instruments.length)]!;
      const side: 'long' | 'short' = this.rnd() < 0.5 ? 'long' : 'short';
      const qty = 1 + Math.floor(this.rnd() * (inst.pointValue >= 50 ? 2 : 4));
      const risk = inst.vol * (8 + this.rnd() * 10);
      const orderId = `DEMO-ORD-${randomId()}`;
      if (a.robot) {
        this.robot(a, 'signal', inst.symbol, side, qty, inst.price, null, 'Rompimento do canal');
      }
      // Nem todo sinal vira operação: mostra a diferença entre sinal e execução.
      if (a.robot && this.rnd() < 0.25) return;
      const p: SimPosition = {
        inst,
        side,
        qty,
        avg: inst.price,
        openedAt: now,
        orderId,
        stop: roundTick(side === 'long' ? inst.price - risk : inst.price + risk, inst.tick),
        target: roundTick(side === 'long' ? inst.price + risk * (a.skill * 2.4) : inst.price - risk * (a.skill * 2.4), inst.tick),
      };
      a.positions.push(p);
      this.exec(a, inst, side === 'long' ? 'buy' : 'sell', qty, inst.price, orderId, now);
      if (a.robot) this.robot(a, 'entry_executed', inst.symbol, side, qty, inst.price, orderId);
    }
    if (a.robot && this.rnd() < 0.002) this.robot(a, 'channel_formed', a.instruments[0]!.symbol, null, null, null, null);
  }

  private close(a: SimAccount, p: SimPosition, now: number, reason: 'take_profit' | 'stop_loss' | 'position_closed') {
    const px = p.inst.price;
    const pnl = (p.side === 'long' ? px - p.avg : p.avg - px) * p.qty * p.inst.pointValue - p.qty * 4.1;
    a.realizedToday = round(a.realizedToday + pnl);
    a.positions = a.positions.filter((x) => x !== p);
    const orderId = `DEMO-ORD-${randomId()}`;
    this.exec(a, p.inst, p.side === 'long' ? 'sell' : 'buy', p.qty, px, orderId, now);
    if (a.robot) this.robot(a, reason, p.inst.symbol, p.side, p.qty, px, orderId);
  }

  private exec(a: SimAccount, inst: Instrument, side: 'buy' | 'sell', qty: number, price: number, orderId: string, now: number) {
    this.pendingExecutions.push({
      account: a.name,
      execId: `DEMO-EX-${randomId()}`,
      time: new Date(now).toISOString(),
      instrument: inst.symbol,
      side,
      quantity: qty,
      price,
      orderId,
    });
  }

  private robot(
    a: SimAccount,
    type: 'signal' | 'entry_executed' | 'take_profit' | 'stop_loss' | 'position_closed' | 'channel_formed',
    instrument: string,
    side: 'long' | 'short' | null,
    qty: number | null,
    price: number | null,
    orderId: string | null,
    message?: string,
  ) {
    const t = this.now();
    // Throttle global para não inundar o painel.
    if (type === 'channel_formed' && t - this.lastRobotAt < 3000) return;
    this.lastRobotAt = t;
    void this.engine.ingestRobot(
      {
        eventId: randomId(),
        type,
        account: a.name,
        strategy: 'Black Wolf DEMO',
        instrument,
        side: side == null ? null : side === 'long' ? 'buy' : 'sell',
        quantity: qty,
        price,
        orderId,
        message: message ?? null,
        time: new Date(t).toISOString(),
      },
      'demo',
    );
  }

  payload(): CollectorPayload {
    const executions = this.pendingExecutions;
    this.pendingExecutions = [];
    const accounts: CollectorAccount[] = this.accounts.map((a) => {
      const unreal = round(
        a.positions.reduce((s, p) => s + (p.side === 'long' ? p.inst.price - p.avg : p.avg - p.inst.price) * p.qty * p.inst.pointValue, 0),
      );
      const cash = round(a.sodBalance + a.realizedToday);
      const items: CollectorAccount['items'] = {
        CashValue: cash,
        NetLiquidation: round(cash + unreal),
        UnrealizedProfitLoss: unreal,
        SodCashValue: a.sodBalance,
      };
      if (a.hasRealized) items.RealizedProfitLoss = a.realizedToday;
      return {
        name: a.name,
        connection: a.connection,
        provider: a.provider,
        connectionStatus: a.connected ? 'connected' : 'connection_lost',
        priceStatus: a.connected ? 'connected' : 'connection_lost',
        denomination: 'USD',
        items,
        positions: a.positions.map((p) => ({
          instrument: p.inst.symbol,
          side: p.side,
          quantity: p.qty,
          avgPrice: p.avg,
          unrealized: round((p.side === 'long' ? p.inst.price - p.avg : p.avg - p.inst.price) * p.qty * p.inst.pointValue),
        })),
        orders: a.positions.flatMap((p) => [
          {
            orderId: `${p.orderId}-SL`,
            instrument: p.inst.symbol,
            action: p.side === 'long' ? 'Sell' : 'BuyToCover',
            type: 'StopMarket',
            quantity: p.qty,
            filled: 0,
            limitPrice: null,
            stopPrice: p.stop,
            state: 'Working',
            name: 'Stop loss',
          },
          {
            orderId: `${p.orderId}-TP`,
            instrument: p.inst.symbol,
            action: p.side === 'long' ? 'Sell' : 'BuyToCover',
            type: 'Limit',
            quantity: p.qty,
            filled: 0,
            limitPrice: p.target,
            stopPrice: null,
            state: 'Working',
            name: 'Profit target',
          },
        ]),
      };
    });
    return {
      v: 1,
      collectorId: 'demo-simulator',
      sessionId: this.sessionId,
      seq: ++this.seq,
      sentAt: new Date(this.now()).toISOString(),
      version: 'demo-1',
      connections: [
        { name: 'DEMO Rithmic', provider: 'Rithmic', status: 'connected' },
        { name: 'DEMO Tradovate', provider: 'Tradovate', status: 'connected' },
      ],
      accounts,
      executions,
    };
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
const roundTick = (v: number, tick: number) => Math.round(Math.round(v / tick) * tick * 10000) / 10000;
