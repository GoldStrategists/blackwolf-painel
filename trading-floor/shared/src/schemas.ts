import { z } from 'zod';
import { ROBOT_EVENT_TYPES } from './types.js';

// Limites duros contra payloads abusivos.
const str = (max = 128) => z.string().min(1).max(max);
const optStr = (max = 128) => z.string().max(max).nullish();
const num = z.number().finite();
const optNum = num.nullish();

export const connStatusSchema = z.enum(['connected', 'connecting', 'connection_lost', 'disconnecting', 'disconnected', 'unknown']);

/** Itens de conta do NinjaTrader 8 (enum AccountItem) que o coletor pode mandar. */
export const NT8_ACCOUNT_ITEMS = [
  'BuyingPower',
  'CashValue',
  'Commission',
  'ExcessIntradayMargin',
  'ExcessInitialMargin',
  'ExcessMaintenanceMargin',
  'Fee',
  'GrossRealizedProfitLoss',
  'InitialMargin',
  'IntradayMargin',
  'MaintenanceMargin',
  'NetLiquidation',
  'RealizedProfitLoss',
  'SodCashValue',
  'SodLiquidatingValue',
  'TotalCashBalance',
  'UnrealizedProfitLoss',
] as const;

export const collectorPositionSchema = z.object({
  instrument: str(64),
  side: z.enum(['long', 'short']),
  quantity: z.number().int().min(0).max(100000),
  avgPrice: optNum,
  unrealized: optNum,
});

export const collectorOrderSchema = z.object({
  orderId: str(128),
  instrument: str(64),
  action: str(32),
  type: str(32),
  quantity: z.number().int().min(0).max(100000),
  filled: z.number().int().min(0).max(100000),
  limitPrice: optNum,
  stopPrice: optNum,
  state: str(32),
  name: optStr(64),
});

export const collectorAccountSchema = z.object({
  name: str(128),
  connection: optStr(128),
  provider: optStr(64),
  connectionStatus: connStatusSchema,
  priceStatus: connStatusSchema.nullish(),
  denomination: optStr(16),
  /** Somente os itens que a plataforma efetivamente reportou. */
  items: z.record(z.enum(NT8_ACCOUNT_ITEMS), num).default({}),
  positions: z.array(collectorPositionSchema).max(500).default([]),
  orders: z.array(collectorOrderSchema).max(1000).default([]),
});

export const collectorExecutionSchema = z.object({
  account: str(128),
  execId: str(128),
  time: z.string().datetime({ offset: true }),
  instrument: str(64),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1).max(100000),
  price: num,
  orderId: optStr(128),
});

export const collectorPayloadSchema = z.object({
  v: z.literal(1),
  collectorId: str(64).regex(/^[A-Za-z0-9._-]+$/),
  sessionId: str(64),
  seq: z.number().int().min(0),
  sentAt: z.string().datetime({ offset: true }),
  version: optStr(64),
  connections: z
    .array(z.object({ name: str(128), provider: optStr(64), status: connStatusSchema }))
    .max(50)
    .default([]),
  accounts: z.array(collectorAccountSchema).max(500),
  executions: z.array(collectorExecutionSchema).max(5000).default([]),
});
export type CollectorPayload = z.infer<typeof collectorPayloadSchema>;
export type CollectorAccount = z.infer<typeof collectorAccountSchema>;
export type CollectorExecution = z.infer<typeof collectorExecutionSchema>;

/** Evento enviado pelo robô Black Wolf (informativo; nunca vira execução confirmada). */
export const robotEventSchema = z.object({
  eventId: str(128),
  type: z.enum(ROBOT_EVENT_TYPES),
  /** Nome da conta como aparece na plataforma (ex.: APEX-12345-01). */
  account: optStr(128),
  strategy: optStr(64),
  instrument: optStr(64),
  side: z.enum(['buy', 'sell']).nullish(),
  quantity: z.number().int().min(0).max(100000).nullish(),
  price: optNum,
  orderId: optStr(128),
  message: optStr(500),
  time: z.string().datetime({ offset: true }).nullish(),
  data: z.record(z.union([z.string().max(500), num, z.boolean(), z.null()])).optional(),
});
export type RobotEventInput = z.infer<typeof robotEventSchema>;

export const riskRuleSchema = z.object({
  type: z.enum(['none', 'static', 'trailing_intraday', 'trailing_eod']),
  maxDrawdown: z.number().positive().max(10_000_000).nullable(),
  trailStopOffset: z.number().min(-10_000_000).max(10_000_000).nullable(),
  dailyLossLimit: z.number().positive().max(10_000_000).nullable(),
  warnAtPct: z.number().min(0.05).max(0.99),
  manualThreshold: z.number().min(0).max(1_000_000_000).nullable(),
  manualThresholdSetAt: z.string().datetime({ offset: true }).nullable(),
  eodTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  eodTimeZone: z.string().min(1).max(64),
});

export const accountPatchSchema = z
  .object({
    displayName: z.string().min(1).max(64),
    roomId: z.string().min(1).max(64),
    deskIndex: z.number().int().min(0).max(10000),
    firm: z.string().max(64).nullable(),
    plan: z.string().max(64).nullable(),
    nominalSize: z.number().min(0).max(1_000_000_000).nullable(),
    startingBalance: z.number().min(0).max(1_000_000_000).nullable(),
    rule: riskRuleSchema,
    hidden: z.boolean(),
  })
  .partial()
  .strict();
export type AccountPatch = z.infer<typeof accountPatchSchema>;

export const roomInputSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(64),
    sort: z.number().int().min(0).max(1000),
  })
  .strict();

export const accountCreateSchema = z
  .object({
    name: z.string().min(1).max(128),
    displayName: z.string().min(1).max(64).optional(),
    roomId: z.string().min(1).max(64),
    platform: z.string().min(1).max(64).optional(),
    provider: z.string().max(64).nullable().optional(),
    firm: z.string().max(64).nullable().optional(),
    plan: z.string().max(64).nullable().optional(),
    nominalSize: z.number().min(0).max(1_000_000_000).nullable().optional(),
    startingBalance: z.number().min(0).max(1_000_000_000).nullable().optional(),
  })
  .strict();

export const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).strict();

export const historyQuerySchema = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
});

export const tokenCreateSchema = z
  .object({ name: z.string().min(1).max(64), kind: z.enum(['nt8', 'robot']) })
  .strict();
