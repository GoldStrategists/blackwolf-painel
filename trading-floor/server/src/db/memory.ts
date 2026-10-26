import type { AccountConfig, ActivityEvent, EquityPoint, ExecutionRecord, Mode, Room } from '@bw/shared';
import type { ConfigRepo, DataRepo, IngestTokenRow, UserRow } from './repo.js';

export function downsample<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(rows[Math.floor(i * step)]!);
  out[out.length - 1] = rows[rows.length - 1]!;
  return out;
}

export class MemoryConfigRepo implements ConfigRepo {
  readonly persistent = false;
  private users = new Map<string, UserRow>();
  private sessions = new Map<string, { userId: number; expiresAt: Date }>();
  private tokens: (IngestTokenRow & { tokenHash: string })[] = [];
  private rooms = new Map<string, Room>();
  private accounts = new Map<string, AccountConfig>();
  private seq = 1;

  async getUserByName(username: string) {
    return this.users.get(username) ?? null;
  }
  async upsertUser(username: string, passwordHash: string) {
    const existing = this.users.get(username);
    const row = { id: existing?.id ?? this.seq++, username, passwordHash };
    this.users.set(username, row);
    return row;
  }
  async countUsers() {
    return this.users.size;
  }
  async createSession(tokenHash: string, userId: number, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }
  async getSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    const user = [...this.users.values()].find((u) => u.id === s.userId);
    if (!user) return null;
    return { userId: s.userId, username: user.username, expiresAt: s.expiresAt };
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async purgeSessions() {
    const now = Date.now();
    for (const [k, v] of this.sessions) if (v.expiresAt.getTime() < now) this.sessions.delete(k);
  }
  async listTokens() {
    return this.tokens.map(({ tokenHash: _h, ...t }) => t);
  }
  async createToken(name: string, kind: 'nt8' | 'robot', tokenHash: string) {
    const row = { id: this.seq++, name, kind, tokenHash, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
    this.tokens.push(row);
    const { tokenHash: _h, ...pub } = row;
    return pub;
  }
  async revokeToken(id: number) {
    const t = this.tokens.find((x) => x.id === id);
    if (t) t.revokedAt = new Date().toISOString();
  }
  async findToken(tokenHash: string) {
    const t = this.tokens.find((x) => x.tokenHash === tokenHash);
    if (!t) return null;
    const { tokenHash: _h, ...pub } = t;
    return pub;
  }
  async touchToken(id: number) {
    const t = this.tokens.find((x) => x.id === id);
    if (t) t.lastUsedAt = new Date().toISOString();
  }
  async listRooms(mode: Mode) {
    return [...this.rooms.values()].filter((r) => r.mode === mode).sort((a, b) => a.sort - b.sort);
  }
  async upsertRoom(room: Room) {
    this.rooms.set(`${room.mode}:${room.id}`, { ...room });
  }
  async deleteRoom(mode: Mode, id: string) {
    this.rooms.delete(`${mode}:${id}`);
  }
  async listAccounts(mode: Mode) {
    return [...this.accounts.values()].filter((a) => a.mode === mode).map((a) => structuredClone(a));
  }
  async upsertAccount(acc: AccountConfig) {
    this.accounts.set(`${acc.mode}:${acc.id}`, structuredClone(acc));
  }
  async deleteAccount(mode: Mode, id: string) {
    this.accounts.delete(`${mode}:${id}`);
  }
}

export class MemoryDataRepo implements DataRepo {
  readonly persistent = false;
  private executions = new Map<string, ExecutionRecord>();
  private equity = new Map<string, EquityPoint[]>();
  private events: ActivityEvent[] = [];
  private eventIds = new Set<string>();

  constructor(private readonly maxEquityPerAccount = 50_000, private readonly maxEvents = 20_000) {}

  async insertExecution(e: ExecutionRecord) {
    const key = `${e.accountId}|${e.execId}`;
    if (this.executions.has(key)) return false;
    this.executions.set(key, { ...e });
    return true;
  }
  async listExecutions(accountId: string, from: number, to: number, limit: number) {
    return [...this.executions.values()]
      .filter((e) => e.accountId === accountId && e.ts >= from && e.ts <= to)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }
  async insertEquityPoint(accountId: string, p: EquityPoint) {
    let arr = this.equity.get(accountId);
    if (!arr) this.equity.set(accountId, (arr = []));
    const last = arr[arr.length - 1];
    if (last && p.ts <= last.ts) {
      // Pontos fora de ordem são inseridos na posição correta (histórico gerado ou atrasado).
      const idx = arr.findIndex((x) => x.ts >= p.ts);
      if (arr[idx]?.ts === p.ts) arr[idx] = p;
      else arr.splice(idx, 0, p);
    } else arr.push(p);
    if (arr.length > this.maxEquityPerAccount) arr.splice(0, arr.length - this.maxEquityPerAccount);
  }
  async listEquity(accountId: string, from: number, to: number, maxPoints: number) {
    const arr = (this.equity.get(accountId) ?? []).filter((p) => p.ts >= from && p.ts <= to);
    return downsample(arr, maxPoints);
  }
  async insertEvent(e: ActivityEvent) {
    if (this.eventIds.has(e.id)) return false;
    this.eventIds.add(e.id);
    this.events.push(e);
    if (this.events.length > this.maxEvents) {
      const removed = this.events.splice(0, this.events.length - this.maxEvents);
      for (const r of removed) this.eventIds.delete(r.id);
    }
    return true;
  }
  async listEvents(opts: { accountId?: string; from?: number; to?: number; limit: number }) {
    const out: ActivityEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < opts.limit; i--) {
      const e = this.events[i]!;
      if (opts.accountId && e.accountId !== opts.accountId) continue;
      if (opts.from != null && e.ts < opts.from) continue;
      if (opts.to != null && e.ts > opts.to) continue;
      out.push(e);
    }
    return out;
  }
}
