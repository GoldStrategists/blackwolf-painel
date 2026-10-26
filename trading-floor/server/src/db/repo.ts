import type { AccountConfig, ActivityEvent, EquityPoint, ExecutionRecord, Mode, Room } from '@bw/shared';

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
}

export interface IngestTokenRow {
  id: number;
  name: string;
  kind: 'nt8' | 'robot';
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Configuração persistente (usuários, sessões, tokens, salas, contas). */
export interface ConfigRepo {
  readonly persistent: boolean;
  getUserByName(username: string): Promise<UserRow | null>;
  upsertUser(username: string, passwordHash: string): Promise<UserRow>;
  countUsers(): Promise<number>;

  createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void>;
  getSession(tokenHash: string): Promise<{ userId: number; username: string; expiresAt: Date } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  purgeSessions(): Promise<void>;

  listTokens(): Promise<IngestTokenRow[]>;
  createToken(name: string, kind: 'nt8' | 'robot', tokenHash: string): Promise<IngestTokenRow>;
  revokeToken(id: number): Promise<void>;
  findToken(tokenHash: string): Promise<IngestTokenRow | null>;
  touchToken(id: number): Promise<void>;

  listRooms(mode: Mode): Promise<Room[]>;
  upsertRoom(room: Room): Promise<void>;
  deleteRoom(mode: Mode, id: string): Promise<void>;

  listAccounts(mode: Mode): Promise<AccountConfig[]>;
  upsertAccount(acc: AccountConfig): Promise<void>;
  deleteAccount(mode: Mode, id: string): Promise<void>;
}

/** Dados financeiros/históricos de UM modo. DEMO usa sempre memória. */
export interface DataRepo {
  readonly persistent: boolean;
  /** Retorna false se a execução já existia (deduplicação). */
  insertExecution(e: ExecutionRecord): Promise<boolean>;
  listExecutions(accountId: string, from: number, to: number, limit: number): Promise<ExecutionRecord[]>;
  insertEquityPoint(accountId: string, p: EquityPoint): Promise<void>;
  listEquity(accountId: string, from: number, to: number, maxPoints: number): Promise<EquityPoint[]>;
  insertEvent(e: ActivityEvent): Promise<boolean>;
  listEvents(opts: { accountId?: string; from?: number; to?: number; limit: number }): Promise<ActivityEvent[]>;
}
