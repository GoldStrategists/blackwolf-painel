import {
  DEFAULT_RULE,
  EMPTY_RISK_STATE,
  deskStatus,
  evaluateRisk,
  type AccountConfig,
  type AccountPatch,
  type AccountView,
  type ActivityEvent,
  type CollectorAccount,
  type CollectorPayload,
  type CollectorStatus,
  type ConnStatus,
  type ExecutionRecord,
  type Mode,
  type PositionView,
  type RiskView,
  type RobotEventInput,
  type Room,
  type ServerMessage,
  type Severity,
  type Summary,
} from '@bw/shared';
import type { ConfigRepo, DataRepo } from './db/repo.js';
import { Hub } from './hub.js';
import { randomId } from './security.js';

export const DEFAULT_ROOMS: Omit<Room, 'mode'>[] = [
  { id: 'apex-rithmic', name: 'SALA 1 · APEX RITHMIC', sort: 1 },
  { id: 'apex-tradovate', name: 'SALA 2 · APEX TRADOVATE', sort: 2 },
  { id: 'outras-prop', name: 'SALA 3 · OUTRAS PROP FIRMS', sort: 3 },
  { id: 'pessoais', name: 'SALA 4 · CONTAS PESSOAIS', sort: 4 },
];

interface Runtime {
  config: AccountConfig;
  raw: CollectorAccount | null;
  collectorId: string | null;
  /** Conta sumiu do último envio do coletor (removida/desconectada na plataforma). */
  missing: boolean;
  lastUpdateAt: number | null;
  view: AccountView | null;
  viewKey: string;
  spark: number[];
  lastSparkAt: number;
  lastPersistAt: number;
  lastPersistKey: string;
  riskKey: string;
  prevStatus: AccountView['status'] | null;
  prevConn: ConnStatus | null;
}

interface CollectorRuntime {
  collectorId: string;
  kind: 'nt8' | 'demo';
  sessionId: string;
  lastSeq: number;
  lastSentAt: number;
  lastSeenAt: number;
  lagMs: number | null;
  version: string | null;
  connections: CollectorStatus['connections'];
  wasFresh: boolean;
}

export interface EngineOptions {
  staleAfterMs: number;
  /** Intervalo mínimo entre pontos de equity persistidos por conta. */
  persistEveryMs: number;
  now?: () => number;
}

const CONN_PT: Record<ConnStatus, string> = {
  connected: 'conectada',
  connecting: 'conectando',
  connection_lost: 'conexão perdida',
  disconnecting: 'desconectando',
  disconnected: 'desconectada',
  unknown: 'status de conexão desconhecido',
};

const SPARK_POINTS = 90;
const SPARK_EVERY_MS = 5000;
const RECENT_EVENTS = 300;

const sum = (vals: (number | null)[]) => {
  let acc = 0;
  for (const v of vals) {
    if (v == null) return null;
    acc += v;
  }
  return Math.round(acc * 100) / 100;
};

export class ModeEngine {
  readonly hub = new Hub();
  private accounts = new Map<string, Runtime>();
  private collectors = new Map<string, CollectorRuntime>();
  private rooms: Room[] = [];
  private recentEvents: ActivityEvent[] = [];
  private recentExecutions: ExecutionRecord[] = [];
  private summaryKey = '';
  private summary: Summary | null = null;
  private now: () => number;
  private configDirty = new Set<string>();

  constructor(
    readonly mode: Mode,
    private readonly config: ConfigRepo,
    readonly data: DataRepo,
    private readonly opts: EngineOptions,
  ) {
    this.now = opts.now ?? Date.now;
    if (mode === 'demo' && data.persistent) throw new Error('DEMO nunca pode usar armazenamento financeiro persistente');
  }

  async init() {
    this.rooms = await this.config.listRooms(this.mode);
    if (this.rooms.length === 0) {
      for (const r of DEFAULT_ROOMS) await this.config.upsertRoom({ ...r, mode: this.mode });
      this.rooms = await this.config.listRooms(this.mode);
    }
    for (const c of await this.config.listAccounts(this.mode)) this.accounts.set(c.id, this.newRuntime(c));
    this.recentEvents = (await this.data.listEvents({ limit: RECENT_EVENTS })).reverse();
    this.recomputeAll();
  }

  private newRuntime(config: AccountConfig): Runtime {
    return {
      config,
      raw: null,
      collectorId: null,
      missing: false,
      lastUpdateAt: null,
      view: null,
      viewKey: '',
      spark: [],
      lastSparkAt: 0,
      lastPersistAt: 0,
      lastPersistKey: '',
      riskKey: JSON.stringify(config.riskState),
      prevStatus: null,
      prevConn: null,
    };
  }

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  snapshot(): Extract<ServerMessage, { t: 'snapshot' }> {
    return {
      t: 'snapshot',
      mode: this.mode,
      epoch: this.hub.epoch,
      seq: this.hub.currentSeq,
      accounts: this.views(),
      rooms: this.rooms,
      summary: this.summary ?? this.computeSummary(),
      events: this.recentEvents.slice(-150),
    };
  }

  views(): AccountView[] {
    return [...this.accounts.values()].filter((r) => !r.config.hidden && r.view).map((r) => r.view!);
  }

  getAccount(id: string) {
    return this.accounts.get(id)?.config ?? null;
  }

  getRooms() {
    return this.rooms;
  }

  listConfigs() {
    return [...this.accounts.values()].map((r) => r.config);
  }

  // -------------------------------------------------------------------------
  // Entrada de dados do coletor (NinjaTrader 8 ou simulador DEMO)
  // -------------------------------------------------------------------------

  async ingest(p: CollectorPayload, kind: 'nt8' | 'demo'): Promise<{ accepted: boolean; reason?: string; newExecutions: number }> {
    const now = this.now();
    const sentAt = Date.parse(p.sentAt);
    let col = this.collectors.get(p.collectorId);

    if (col && col.sessionId === p.sessionId && p.seq <= col.lastSeq) {
      return { accepted: false, reason: 'duplicate', newExecutions: 0 };
    }
    // Snapshot mais velho que o último aplicado (chegou atrasado): ignora o estado, mas
    // ainda processa execuções, que são idempotentes.
    const lateSnapshot = col != null && col.sessionId === p.sessionId && sentAt < col.lastSentAt;

    if (!col) {
      col = {
        collectorId: p.collectorId,
        kind,
        sessionId: p.sessionId,
        lastSeq: p.seq,
        lastSentAt: sentAt,
        lastSeenAt: now,
        lagMs: null,
        version: p.version ?? null,
        connections: [],
        wasFresh: false,
      };
      this.collectors.set(p.collectorId, col);
    }
    if (col.sessionId !== p.sessionId) {
      col.sessionId = p.sessionId;
      this.systemEvent('collector_restarted', `Coletor ${p.collectorId} reiniciou`, 'info', null);
    }
    col.lastSeq = p.seq;
    col.lastSeenAt = now;
    col.version = p.version ?? col.version;
    col.lagMs = Number.isFinite(sentAt) ? now - sentAt : null;

    if (!lateSnapshot) {
      col.lastSentAt = sentAt;
      col.connections = p.connections.map((c) => ({ name: c.name, provider: c.provider ?? null, status: c.status }));
      const seen = new Set<string>();
      for (const acc of p.accounts) {
        const id = this.accountId(acc.name);
        seen.add(id);
        let rt = this.accounts.get(id);
        if (!rt) rt = await this.autoCreate(id, acc);
        rt.raw = acc;
        rt.collectorId = p.collectorId;
        rt.missing = false;
        rt.lastUpdateAt = now;
        if (acc.provider && rt.config.provider !== acc.provider) {
          rt.config.provider = acc.provider;
          this.configDirty.add(id);
        }
        if (acc.connection && rt.config.connectionName !== acc.connection) {
          rt.config.connectionName = acc.connection;
          this.configDirty.add(id);
        }
      }
      for (const [id, rt] of this.accounts) {
        if (rt.collectorId === p.collectorId && !seen.has(id)) rt.missing = true;
      }
    }

    let newExecutions = 0;
    for (const ex of p.executions) {
      const rec: ExecutionRecord = {
        execId: ex.execId,
        accountId: this.accountId(ex.account),
        mode: this.mode,
        ts: Date.parse(ex.time),
        instrument: ex.instrument,
        side: ex.side,
        quantity: ex.quantity,
        price: ex.price,
        orderId: ex.orderId ?? null,
      };
      if (await this.data.insertExecution(rec)) {
        newExecutions++;
        await this.onExecution(rec);
      }
    }

    this.recomputeAll();
    await this.flushConfig();
    return { accepted: true, newExecutions };
  }

  accountId(name: string) {
    return `${this.mode === 'demo' ? 'demo' : 'nt8'}:${name}`;
  }

  private guessRoom(acc: { name: string; provider?: string | null }): string {
    const provider = (acc.provider ?? '').toLowerCase();
    const isApex = /apex|^pa-?apex/i.test(acc.name);
    if (isApex && provider.includes('rithmic')) return 'apex-rithmic';
    if (isApex && provider.includes('tradovate')) return 'apex-tradovate';
    if (isApex) return provider.includes('tradovate') ? 'apex-tradovate' : 'apex-rithmic';
    return this.rooms.find((r) => r.id === 'outras-prop')?.id ?? this.rooms[0]?.id ?? 'outras-prop';
  }

  private nextDeskIndex(roomId: string) {
    let max = -1;
    for (const r of this.accounts.values()) if (r.config.roomId === roomId) max = Math.max(max, r.config.deskIndex);
    return max + 1;
  }

  private async autoCreate(id: string, acc: CollectorAccount): Promise<Runtime> {
    const roomId = this.guessRoom(acc);
    const config: AccountConfig = {
      id,
      mode: this.mode,
      name: acc.name,
      displayName: acc.name,
      roomId,
      deskIndex: this.nextDeskIndex(roomId),
      platform: this.mode === 'demo' ? 'Simulador DEMO' : 'NinjaTrader 8',
      provider: acc.provider ?? null,
      connectionName: acc.connection ?? null,
      firm: /apex/i.test(acc.name) ? 'Apex' : null,
      plan: null,
      nominalSize: null,
      startingBalance: null,
      rule: { ...DEFAULT_RULE },
      riskState: { ...EMPTY_RISK_STATE },
      hidden: false,
    };
    await this.config.upsertAccount(config);
    const rt = this.newRuntime(config);
    this.accounts.set(id, rt);
    this.systemEvent('account_discovered', `Nova conta detectada: ${acc.name}. Configure tamanho e regras de risco.`, 'info', id);
    return rt;
  }

  private async onExecution(rec: ExecutionRecord) {
    this.recentExecutions.push(rec);
    if (this.recentExecutions.length > 500) this.recentExecutions.splice(0, 100);

    const ev: ActivityEvent = {
      id: `exec:${rec.accountId}:${rec.execId}`,
      mode: this.mode,
      ts: rec.ts,
      kind: 'execution',
      type: 'execution',
      accountId: rec.accountId,
      severity: 'success',
      message: `${rec.side === 'buy' ? 'COMPRA' : 'VENDA'} ${rec.quantity} ${rec.instrument} @ ${rec.price}`,
      confirmed: true,
      correlatedExecutionId: null,
      payload: { instrument: rec.instrument, side: rec.side, quantity: rec.quantity, price: rec.price, orderId: rec.orderId },
    };
    await this.pushEvent(ev);

    // Liga eventos do robô ainda sem confirmação a esta execução real.
    for (const e of this.recentEvents) {
      if (e.kind !== 'robot' || e.correlatedExecutionId || e.accountId !== rec.accountId) continue;
      if (!['entry_executed', 'take_profit', 'stop_loss', 'position_closed'].includes(e.type)) continue;
      if (this.matches(e, rec)) {
        e.correlatedExecutionId = rec.execId;
        this.hub.publish({ t: 'event', mode: this.mode, event: e });
        break;
      }
    }
  }

  private matches(e: ActivityEvent, rec: ExecutionRecord) {
    const orderId = e.payload.orderId as string | null | undefined;
    if (orderId && rec.orderId) return orderId === rec.orderId;
    const instrument = e.payload.instrument as string | null | undefined;
    const sameInstrument = !instrument || rec.instrument.startsWith(instrument) || instrument.startsWith(rec.instrument.split(' ')[0]!);
    return sameInstrument && Math.abs(e.ts - rec.ts) <= 15_000;
  }

  // -------------------------------------------------------------------------
  // Eventos do robô Black Wolf (informativos)
  // -------------------------------------------------------------------------

  async ingestRobot(input: RobotEventInput, sourceId: string): Promise<{ accepted: boolean; event?: ActivityEvent }> {
    const accountId = input.account ? this.accountId(input.account) : null;
    const ts = input.time ? Date.parse(input.time) : this.now();
    const labels: Record<string, [string, Severity]> = {
      strategy_enabled: ['Estratégia ativada', 'info'],
      strategy_paused: ['Estratégia pausada', 'warning'],
      channel_formed: ['Canal formado', 'info'],
      signal: ['Sinal identificado', 'info'],
      entry_executed: ['Robô informou entrada', 'info'],
      take_profit: ['Robô informou take profit', 'info'],
      stop_loss: ['Robô informou stop loss', 'warning'],
      position_closed: ['Robô informou encerramento', 'info'],
      error: ['Erro operacional do robô', 'error'],
    };
    const [label, severity] = labels[input.type]!;
    const details = [input.strategy, input.instrument, input.side?.toUpperCase(), input.quantity, input.price != null ? `@ ${input.price}` : null]
      .filter((x) => x != null && x !== '')
      .join(' ');
    const ev: ActivityEvent = {
      id: `robot:${sourceId}:${input.eventId}`,
      mode: this.mode,
      ts,
      kind: 'robot',
      type: input.type,
      accountId,
      severity,
      message: [label, details, input.message].filter(Boolean).join(' · '),
      confirmed: false,
      correlatedExecutionId: null,
      payload: {
        strategy: input.strategy ?? null,
        instrument: input.instrument ?? null,
        side: input.side ?? null,
        quantity: input.quantity ?? null,
        price: input.price ?? null,
        orderId: input.orderId ?? null,
        ...(input.data ?? {}),
      },
    };
    if (accountId && ['entry_executed', 'take_profit', 'stop_loss', 'position_closed'].includes(ev.type)) {
      const match = [...this.recentExecutions].reverse().find((r) => r.accountId === accountId && this.matches(ev, r));
      if (match) ev.correlatedExecutionId = match.execId;
    }
    const inserted = await this.pushEvent(ev);
    return { accepted: inserted, event: ev };
  }

  private async pushEvent(ev: ActivityEvent): Promise<boolean> {
    const inserted = await this.data.insertEvent(ev);
    if (!inserted) return false;
    this.recentEvents.push(ev);
    if (this.recentEvents.length > RECENT_EVENTS) this.recentEvents.splice(0, this.recentEvents.length - RECENT_EVENTS);
    this.hub.publish({ t: 'event', mode: this.mode, event: ev });
    return true;
  }

  private systemEvent(type: string, message: string, severity: Severity, accountId: string | null, kind: ActivityEvent['kind'] = 'system') {
    void this.pushEvent({
      id: `sys:${randomId()}`,
      mode: this.mode,
      ts: this.now(),
      kind,
      type,
      accountId,
      severity,
      message,
      confirmed: false,
      correlatedExecutionId: null,
      payload: {},
    });
  }

  // -------------------------------------------------------------------------
  // Configuração (salas e contas)
  // -------------------------------------------------------------------------

  async patchAccount(id: string, patch: AccountPatch): Promise<AccountConfig | null> {
    const rt = this.accounts.get(id);
    if (!rt) return null;
    if (patch.roomId && !this.rooms.some((r) => r.id === patch.roomId)) throw new Error('Sala inexistente');
    const before = rt.config;
    const next: AccountConfig = { ...before, ...patch, rule: patch.rule ? { ...before.rule, ...patch.rule } : before.rule };
    const r0 = before.rule;
    const r1 = next.rule;
    const riskChanged =
      r0.type !== r1.type ||
      r0.maxDrawdown !== r1.maxDrawdown ||
      r0.manualThreshold !== r1.manualThreshold ||
      before.startingBalance !== next.startingBalance;
    if (riskChanged) {
      next.riskState = { ...EMPTY_RISK_STATE };
      if (r1.manualThreshold !== r0.manualThreshold) next.rule = { ...r1, manualThresholdSetAt: r1.manualThreshold != null ? new Date(this.now()).toISOString() : null };
    }
    if (patch.roomId && patch.roomId !== before.roomId && patch.deskIndex == null) next.deskIndex = this.nextDeskIndex(patch.roomId);
    rt.config = next;
    await this.config.upsertAccount(next);
    rt.riskKey = JSON.stringify(next.riskState);
    this.recomputeAll(true);
    if (next.hidden && !before.hidden) this.hub.publish({ t: 'account_removed', mode: this.mode, id });
    return next;
  }

  async createAccount(input: {
    name: string;
    displayName?: string;
    roomId: string;
    platform?: string;
    provider?: string | null;
    firm?: string | null;
    plan?: string | null;
    nominalSize?: number | null;
    startingBalance?: number | null;
  }): Promise<AccountConfig> {
    const id = this.accountId(input.name);
    if (this.accounts.has(id)) throw new Error('Conta já cadastrada');
    if (!this.rooms.some((r) => r.id === input.roomId)) throw new Error('Sala inexistente');
    const config: AccountConfig = {
      id,
      mode: this.mode,
      name: input.name,
      displayName: input.displayName ?? input.name,
      roomId: input.roomId,
      deskIndex: this.nextDeskIndex(input.roomId),
      platform: input.platform ?? (this.mode === 'demo' ? 'Simulador DEMO' : 'NinjaTrader 8'),
      provider: input.provider ?? null,
      connectionName: null,
      firm: input.firm ?? null,
      plan: input.plan ?? null,
      nominalSize: input.nominalSize ?? null,
      startingBalance: input.startingBalance ?? null,
      rule: { ...DEFAULT_RULE },
      riskState: { ...EMPTY_RISK_STATE },
      hidden: false,
    };
    await this.config.upsertAccount(config);
    this.accounts.set(id, this.newRuntime(config));
    this.recomputeAll(true);
    return config;
  }

  async deleteAccount(id: string) {
    if (!this.accounts.delete(id)) return false;
    await this.config.deleteAccount(this.mode, id);
    this.hub.publish({ t: 'account_removed', mode: this.mode, id });
    this.recomputeAll(true);
    return true;
  }

  async upsertRoom(room: Omit<Room, 'mode'>) {
    await this.config.upsertRoom({ ...room, mode: this.mode });
    this.rooms = await this.config.listRooms(this.mode);
    this.hub.publish({ t: 'rooms', mode: this.mode, rooms: this.rooms });
  }

  async deleteRoom(id: string) {
    if ([...this.accounts.values()].some((r) => r.config.roomId === id)) throw new Error('Mova as contas desta sala antes de excluí-la');
    await this.config.deleteRoom(this.mode, id);
    this.rooms = await this.config.listRooms(this.mode);
    this.hub.publish({ t: 'rooms', mode: this.mode, rooms: this.rooms });
  }

  /** Reordena as mesas de uma sala de acordo com a lista de ids. */
  async reorderRoom(roomId: string, ids: string[]) {
    let i = 0;
    for (const id of ids) {
      const rt = this.accounts.get(id);
      if (!rt || rt.config.roomId !== roomId) continue;
      rt.config = { ...rt.config, deskIndex: i++ };
      await this.config.upsertAccount(rt.config);
    }
    this.recomputeAll(true);
  }

  // -------------------------------------------------------------------------
  // Cálculo
  // -------------------------------------------------------------------------

  /** Chamado a cada ~1s: detecta dados desatualizados e grava histórico. */
  async tick() {
    const now = this.now();
    for (const col of this.collectors.values()) {
      const fresh = now - col.lastSeenAt <= this.opts.staleAfterMs;
      if (col.wasFresh && !fresh) this.systemEvent('collector_lost', `Sem dados do coletor ${col.collectorId} há mais de ${Math.round(this.opts.staleAfterMs / 1000)}s`, 'error', null, 'alert');
      if (!col.wasFresh && fresh && col.kind === 'nt8') this.systemEvent('collector_online', `Coletor ${col.collectorId} conectado`, 'success', null);
      col.wasFresh = fresh;
    }
    this.recomputeAll();
    for (const rt of this.accounts.values()) {
      const v = rt.view;
      if (!v || !v.fresh) continue;
      if (now - rt.lastSparkAt >= SPARK_EVERY_MS && v.equity != null) {
        rt.spark.push(v.equity);
        if (rt.spark.length > SPARK_POINTS) rt.spark.shift();
        rt.lastSparkAt = now;
      }
      const key = `${v.balance}|${v.equity}|${v.realizedToday}|${v.unrealized}`;
      if (now - rt.lastPersistAt >= this.opts.persistEveryMs && key !== rt.lastPersistKey) {
        rt.lastPersistAt = now;
        rt.lastPersistKey = key;
        await this.data.insertEquityPoint(rt.config.id, {
          ts: now,
          balance: v.balance,
          equity: v.equity,
          realized: v.realizedToday,
          unrealized: v.unrealized,
        });
      }
    }
    await this.flushConfig();
  }

  private async flushConfig() {
    for (const id of this.configDirty) {
      const rt = this.accounts.get(id);
      if (rt) await this.config.upsertAccount(rt.config);
    }
    this.configDirty.clear();
  }

  private recomputeAll(forceSummary = false) {
    const now = this.now();
    for (const rt of this.accounts.values()) {
      const view = this.computeView(rt, now);
      const { lastUpdateAt: _l, ...rest } = view;
      const key = JSON.stringify(rest);
      rt.view = view;
      if (key !== rt.viewKey) {
        rt.viewKey = key;
        if (!rt.config.hidden) this.hub.publish({ t: 'account', mode: this.mode, account: view });
        this.transitions(rt, view);
      }
    }
    const summary = this.computeSummary();
    const { generatedAt: _g, collectors, ...rest } = summary;
    const key = JSON.stringify({ ...rest, collectors: collectors.map((c) => ({ ...c, lastSeenAt: 0, lagMs: c.lagMs == null ? null : Math.round(c.lagMs / 250) })) });
    this.summary = summary;
    if (forceSummary || key !== this.summaryKey) {
      this.summaryKey = key;
      this.hub.publish({ t: 'summary', mode: this.mode, summary });
    }
  }

  /** Evita repetir o mesmo alerta quando a conta oscila em torno do limite. */
  private alertCooldown = new Map<string, number>();
  private throttledAlert(key: string, fn: () => void, ms = 120_000) {
    const now = this.now();
    if (now - (this.alertCooldown.get(key) ?? 0) < ms) return;
    this.alertCooldown.set(key, now);
    fn();
  }

  private transitions(rt: Runtime, v: AccountView) {
    const prev = rt.prevStatus;
    rt.prevStatus = v.status;
    if (rt.prevConn !== null && rt.prevConn !== v.connStatus) {
      const ok = v.connStatus === 'connected';
      this.systemEvent('connection', `${v.displayName}: ${ok ? 'conexão restabelecida' : CONN_PT[v.connStatus]}`, ok ? 'success' : 'warning', v.id);
    }
    rt.prevConn = v.connStatus;
    if (prev == null || prev === v.status) return;
    if (v.status === 'risk' && prev !== 'breach')
      this.throttledAlert(`warn:${v.id}`, () => this.systemEvent('risk_warn', `${v.displayName}: próxima do limite de risco`, 'warning', v.id, 'alert'));
    if (v.status === 'breach')
      this.throttledAlert(`breach:${v.id}`, () => this.systemEvent('risk_breach', `${v.displayName}: LIMITE DE RISCO ATINGIDO`, 'error', v.id, 'alert'), 300_000);
    if (v.status === 'stale' && prev !== 'offline') this.systemEvent('stale', `${v.displayName}: dados desatualizados`, 'warning', v.id, 'alert');
  }

  private computeView(rt: Runtime, now: number): AccountView {
    const c = rt.config;
    const raw = rt.raw;
    const col = rt.collectorId ? this.collectors.get(rt.collectorId) : undefined;
    const collectorFresh = col ? now - col.lastSeenAt <= this.opts.staleAfterMs : false;
    const recent = rt.lastUpdateAt != null && now - rt.lastUpdateAt <= this.opts.staleAfterMs;

    let connStatus: ConnStatus = 'unknown';
    if (raw) connStatus = rt.missing ? 'disconnected' : raw.connectionStatus;
    const fresh = !!raw && !rt.missing && recent && collectorFresh && connStatus === 'connected';

    const item = (k: keyof CollectorAccount['items']) => (raw?.items[k] ?? null) as number | null;
    const positions: PositionView[] = (raw?.positions ?? []).map((p) => ({
      instrument: p.instrument,
      side: p.side,
      quantity: p.quantity,
      avgPrice: p.avgPrice ?? null,
      unrealized: p.unrealized ?? null,
    }));
    const posUnrealized = positions.length === 0 ? 0 : sum(positions.map((p) => p.unrealized));
    const balance = item('CashValue') ?? item('TotalCashBalance');
    const unrealized = item('UnrealizedProfitLoss') ?? (raw ? posUnrealized : null);
    const equity = item('NetLiquidation') ?? (balance != null && unrealized != null ? Math.round((balance + unrealized) * 100) / 100 : null);
    const realizedToday = item('RealizedProfitLoss');
    const totalToday = realizedToday != null && unrealized != null ? Math.round((realizedToday + unrealized) * 100) / 100 : null;
    const cumulativePnl = balance != null && c.startingBalance != null ? Math.round((balance - c.startingBalance) * 100) / 100 : null;

    const { view: risk, state } = evaluateRisk({
      rule: c.rule,
      state: c.riskState,
      startingBalance: c.startingBalance,
      balance,
      equity,
      totalToday,
      now,
      fresh,
    });
    const riskKey = JSON.stringify(state);
    if (riskKey !== rt.riskKey) {
      rt.riskKey = riskKey;
      rt.config = { ...c, riskState: state };
      this.configDirty.add(c.id);
    }

    const available: string[] = raw ? Object.keys(raw.items) : [];
    if (raw) available.push('positions', 'orders');

    const alerts: string[] = [];
    if (!raw) alerts.push('Sem dados da plataforma para esta conta.');
    else if (rt.missing) alerts.push('A conta não aparece mais no coletor (desconectada ou removida da plataforma).');
    else if (!collectorFresh) alerts.push('Coletor sem comunicação — valores abaixo são os ÚLTIMOS CONHECIDOS.');
    else if (connStatus !== 'connected') alerts.push(`Conexão da plataforma: ${connStatus}.`);
    if (raw && realizedToday == null) alerts.push('A conexão não informou P&L realizado.');
    if (raw && balance == null) alerts.push('A conexão não informou saldo.');
    if (positions.some((p) => p.unrealized == null)) alerts.push('P&L não realizado indisponível para alguma posição (sem cotação).');
    if (c.rule.type === 'none') alerts.push('Regras de risco não configuradas.');
    if (c.startingBalance == null) alerts.push('Saldo inicial não configurado (P&L acumulado indisponível).');
    if (risk.level === 'breach') alerts.unshift('LIMITE DE RISCO ATINGIDO.');
    else if (risk.level === 'warn') alerts.unshift('Próxima do limite de risco.');

    const view: AccountView = {
      id: c.id,
      mode: this.mode,
      name: c.name,
      displayName: c.displayName,
      roomId: c.roomId,
      deskIndex: c.deskIndex,
      platform: c.platform,
      provider: c.provider,
      connectionName: c.connectionName,
      firm: c.firm,
      plan: c.plan,
      currency: raw?.denomination ?? 'USD',
      connStatus,
      fresh,
      lastUpdateAt: rt.lastUpdateAt,
      nominalSize: c.nominalSize,
      startingBalance: c.startingBalance,
      balance,
      equity,
      realizedToday,
      unrealized,
      totalToday,
      cumulativePnl,
      positions,
      orders: (raw?.orders ?? []).map((o) => ({
        orderId: o.orderId,
        instrument: o.instrument,
        action: o.action,
        type: o.type,
        quantity: o.quantity,
        filled: o.filled,
        limitPrice: o.limitPrice ?? null,
        stopPrice: o.stopPrice ?? null,
        state: o.state,
        name: o.name ?? null,
      })),
      contracts: positions.reduce((a, p) => a + p.quantity, 0),
      risk,
      status: 'nodata',
      alerts,
      available,
      sparkline: rt.spark,
    };
    view.status = deskStatus({ ...view, riskLevel: risk.level });
    return view;
  }

  private computeSummary(): Summary {
    const now = this.now();
    const views = [...this.accounts.values()].filter((r) => !r.config.hidden && r.view).map((r) => r.view!);
    const fresh = views.filter((v) => v.fresh);
    const nullableSum = (vals: (number | null)[]) => {
      const known = vals.filter((v): v is number => v != null);
      return known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100 : null;
    };
    const remaining = fresh.map((v) => v.risk.drawdownRemaining).filter((v): v is number => v != null);
    return {
      mode: this.mode,
      accountsTotal: views.length,
      accountsConnected: views.filter((v) => v.connStatus === 'connected').length,
      accountsFresh: fresh.length,
      accountsExcludedStale: views.length - fresh.length,
      accountsPositive: fresh.filter((v) => (v.totalToday ?? 0) > 0.005).length,
      accountsNegative: fresh.filter((v) => (v.totalToday ?? 0) < -0.005).length,
      accountsFlat: fresh.filter((v) => v.totalToday != null && Math.abs(v.totalToday) <= 0.005).length,
      nominalCapital: views.reduce((a, v) => a + (v.nominalSize ?? 0), 0),
      balanceTotal: nullableSum(fresh.map((v) => v.balance)),
      equityTotal: nullableSum(fresh.map((v) => v.equity)),
      realizedToday: nullableSum(fresh.map((v) => v.realizedToday)),
      unrealized: nullableSum(fresh.map((v) => v.unrealized)),
      totalToday: nullableSum(fresh.map((v) => v.totalToday)),
      cumulativePnl: nullableSum(fresh.map((v) => v.cumulativePnl)),
      openPositions: fresh.reduce((a, v) => a + v.positions.length, 0),
      openContracts: fresh.reduce((a, v) => a + v.contracts, 0),
      riskWarn: fresh.filter((v) => v.risk.level === 'warn').length,
      riskBreach: fresh.filter((v) => v.risk.level === 'breach').length,
      riskUnknown: views.filter((v) => v.risk.level === 'unknown').length,
      minDrawdownRemaining: remaining.length ? Math.min(...remaining) : null,
      collectors: [...this.collectors.values()].map((c) => ({
        collectorId: c.collectorId,
        kind: c.kind,
        lastSeenAt: c.lastSeenAt,
        fresh: now - c.lastSeenAt <= this.opts.staleAfterMs,
        lagMs: c.lagMs,
        version: c.version,
        connections: c.connections,
      })),
      generatedAt: now,
    };
  }
}

export type { RiskView };
