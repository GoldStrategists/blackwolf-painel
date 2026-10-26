import type { CollectorAccount, CollectorPayload } from '@bw/shared';

export function account(name: string, over: Partial<CollectorAccount> = {}): CollectorAccount {
  return {
    name,
    connection: 'Rithmic',
    provider: 'Rithmic',
    connectionStatus: 'connected',
    priceStatus: 'connected',
    denomination: 'USD',
    items: { CashValue: 50000, NetLiquidation: 50000, RealizedProfitLoss: 0, UnrealizedProfitLoss: 0 },
    positions: [],
    orders: [],
    ...over,
  };
}

export function payload(seq: number, accounts: CollectorAccount[], over: Partial<CollectorPayload> = {}, now = Date.now()): CollectorPayload {
  return {
    v: 1,
    collectorId: 'pc-test',
    sessionId: 'sess-1',
    seq,
    sentAt: new Date(now).toISOString(),
    version: 'test',
    connections: [{ name: 'Rithmic', provider: 'Rithmic', status: 'connected' }],
    accounts,
    executions: [],
    ...over,
  };
}

export class Clock {
  constructor(public t = Date.parse('2026-10-26T15:00:00Z')) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}
