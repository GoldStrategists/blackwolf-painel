// Tipos de domínio compartilhados entre servidor e navegador.
// Regra de ouro: um valor que a fonte não forneceu é `null`, nunca 0.

export type Mode = 'demo' | 'live';

export type ConnStatus = 'connected' | 'connecting' | 'connection_lost' | 'disconnecting' | 'disconnected' | 'unknown';

/** Cor/estado visual da mesa, em ordem de prioridade (ver deskStatus()). */
export type DeskStatus =
  | 'offline' // plataforma/conta desconectada            → cinza
  | 'stale' //   sem atualização recente da fonte         → cinza
  | 'nodata' //  conectada mas sem dados suficientes      → cinza
  | 'breach' //  limite de risco atingido                 → vermelho pulsante
  | 'risk' //    perto do limite de risco                 → amarelo
  | 'profit' //  lucro no dia                             → verde
  | 'loss' //    prejuízo no dia                          → vermelho
  | 'flat'; //   zerada                                   → azul neutro

export type RiskRuleType = 'none' | 'static' | 'trailing_intraday' | 'trailing_eod';

export interface RiskRule {
  type: RiskRuleType;
  /** Tamanho do drawdown máximo (ex.: 2500). */
  maxDrawdown: number | null;
  /** O trailing para de subir quando o limite chega em saldo inicial + este valor (ex.: 100). null = nunca para. */
  trailStopOffset: number | null;
  /** Perda diária máxima configurada (positivo, ex.: 1000). null = sem limite diário. */
  dailyLossLimit: number | null;
  /** Fração do limite consumida que acende o amarelo (0..1). */
  warnAtPct: number;
  /** Limite de liquidação informado manualmente (ex.: copiado do dashboard da prop firm). */
  manualThreshold: number | null;
  manualThresholdSetAt: string | null;
  /** Horário de fechamento usado no trailing EOD (HH:MM) e fuso. */
  eodTime: string;
  eodTimeZone: string;
}

export interface RiskState {
  /** Maior valor observado usado no trailing (equity p/ intraday, saldo de fechamento p/ EOD). */
  highWaterMark: number | null;
  /** Desde quando o app observa este high-water mark (o histórico anterior é desconhecido). */
  trackingSince: string | null;
  /** Último dia (YYYY-MM-DD no fuso da regra) em que o EOD foi aplicado. */
  lastEodDate: string | null;
}

export type RiskLevel = 'unknown' | 'ok' | 'warn' | 'breach';

export interface RiskView {
  ruleType: RiskRuleType;
  maxDrawdown: number | null;
  liquidationThreshold: number | null;
  drawdownRemaining: number | null;
  drawdownUsedPct: number | null;
  dailyLossLimit: number | null;
  dailyLossRemaining: number | null;
  dailyUsedPct: number | null;
  level: RiskLevel;
  /** De onde veio o limite: manual (informado), computed (calculado localmente) ou none. */
  source: 'manual' | 'computed' | 'none';
  highWaterMark: number | null;
  trackingSince: string | null;
  notes: string[];
}

export interface PositionView {
  instrument: string;
  side: 'long' | 'short';
  quantity: number;
  avgPrice: number | null;
  unrealized: number | null;
}

export interface OrderView {
  orderId: string;
  instrument: string;
  action: string;
  type: string;
  quantity: number;
  filled: number;
  limitPrice: number | null;
  stopPrice: number | null;
  state: string;
  name: string | null;
}

export interface AccountConfig {
  id: string;
  mode: Mode;
  name: string;
  displayName: string;
  roomId: string;
  deskIndex: number;
  platform: string;
  provider: string | null;
  connectionName: string | null;
  firm: string | null;
  plan: string | null;
  /** Tamanho nominal da conta (ex.: 50000). Não é dinheiro próprio. */
  nominalSize: number | null;
  /** Saldo inicial usado para P&L acumulado e drawdown. */
  startingBalance: number | null;
  rule: RiskRule;
  riskState: RiskState;
  hidden: boolean;
}

export interface AccountView {
  id: string;
  mode: Mode;
  name: string;
  displayName: string;
  roomId: string;
  deskIndex: number;
  platform: string;
  provider: string | null;
  connectionName: string | null;
  firm: string | null;
  plan: string | null;
  currency: string;
  connStatus: ConnStatus;
  /** true somente se a fonte mandou dados há pouco tempo E a conexão está ativa. */
  fresh: boolean;
  lastUpdateAt: number | null;
  nominalSize: number | null;
  startingBalance: number | null;
  balance: number | null;
  equity: number | null;
  realizedToday: number | null;
  unrealized: number | null;
  totalToday: number | null;
  cumulativePnl: number | null;
  positions: PositionView[];
  orders: OrderView[];
  contracts: number;
  risk: RiskView;
  status: DeskStatus;
  alerts: string[];
  /** Campos que a fonte efetivamente informou (o resto é indisponível). */
  available: string[];
  sparkline: number[];
}

export interface Room {
  id: string;
  mode: Mode;
  name: string;
  sort: number;
}

export interface Summary {
  mode: Mode;
  accountsTotal: number;
  accountsConnected: number;
  accountsFresh: number;
  accountsExcludedStale: number;
  accountsPositive: number;
  accountsNegative: number;
  accountsFlat: number;
  /** Soma dos tamanhos nominais. NÃO é patrimônio, nem saldo, nem capital sacável. */
  nominalCapital: number;
  balanceTotal: number | null;
  equityTotal: number | null;
  realizedToday: number | null;
  unrealized: number | null;
  totalToday: number | null;
  cumulativePnl: number | null;
  openPositions: number;
  openContracts: number;
  riskWarn: number;
  riskBreach: number;
  riskUnknown: number;
  minDrawdownRemaining: number | null;
  collectors: CollectorStatus[];
  generatedAt: number;
}

export interface CollectorStatus {
  collectorId: string;
  kind: 'nt8' | 'demo';
  lastSeenAt: number;
  fresh: boolean;
  /** Atraso estimado entre envio pelo coletor e chegada no servidor (depende do relógio do PC). */
  lagMs: number | null;
  version: string | null;
  connections: { name: string; provider: string | null; status: ConnStatus }[];
}

export type ActivityKind = 'robot' | 'execution' | 'system' | 'alert';
export type Severity = 'info' | 'success' | 'warning' | 'error';

export const ROBOT_EVENT_TYPES = [
  'strategy_enabled',
  'strategy_paused',
  'channel_formed',
  'signal',
  'entry_executed',
  'take_profit',
  'stop_loss',
  'position_closed',
  'error',
] as const;
export type RobotEventType = (typeof ROBOT_EVENT_TYPES)[number];

export interface ActivityEvent {
  id: string;
  mode: Mode;
  ts: number;
  kind: ActivityKind;
  type: string;
  accountId: string | null;
  severity: Severity;
  message: string;
  /**
   * true SOMENTE para execuções confirmadas pela conta (feed de execuções da plataforma).
   * Eventos do robô nunca são confirmados por si só — no máximo correlacionados.
   */
  confirmed: boolean;
  correlatedExecutionId: string | null;
  payload: Record<string, unknown>;
}

export interface ExecutionRecord {
  execId: string;
  accountId: string;
  mode: Mode;
  ts: number;
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  orderId: string | null;
}

export interface EquityPoint {
  ts: number;
  balance: number | null;
  equity: number | null;
  realized: number | null;
  unrealized: number | null;
}

// ---------------------------------------------------------------------------
// Mensagens WebSocket servidor → navegador
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { t: 'hello'; mode: Mode; serverTime: number; epoch: string }
  | {
      t: 'snapshot';
      mode: Mode;
      epoch: string;
      seq: number;
      accounts: AccountView[];
      rooms: Room[];
      summary: Summary;
      events: ActivityEvent[];
    }
  | { t: 'account'; mode: Mode; seq: number; account: AccountView }
  | { t: 'account_removed'; mode: Mode; seq: number; id: string }
  | { t: 'rooms'; mode: Mode; seq: number; rooms: Room[] }
  | { t: 'summary'; mode: Mode; seq: number; summary: Summary }
  | { t: 'event'; mode: Mode; seq: number; event: ActivityEvent }
  | { t: 'pong'; clientTs: number; serverTime: number }
  | { t: 'ping'; serverTime: number }
  | { t: 'error'; message: string };

/** Mensagens navegador → servidor */
export type ClientMessage =
  | { t: 'subscribe'; mode: Mode; epoch?: string; lastSeq?: number }
  | { t: 'ping'; clientTs: number }
  | { t: 'pong'; serverTime: number };
