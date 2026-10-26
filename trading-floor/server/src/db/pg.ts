import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { AccountConfig, ActivityEvent, EquityPoint, ExecutionRecord, Mode, Room } from '@bw/shared';
import { DEFAULT_RULE, EMPTY_RISK_STATE } from '@bw/shared';
import type { ConfigRepo, DataRepo, IngestTokenRow } from './repo.js';
import { downsample } from './memory.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createPool(url: string) {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const dir = join(here, 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return applied;
}

const iso = (v: Date | null) => (v ? v.toISOString() : null);
const n = (v: string | number | null) => (v == null ? null : Number(v));

function tokenRow(r: any): IngestTokenRow {
  return { id: r.id, name: r.name, kind: r.kind, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), revokedAt: iso(r.revoked_at) };
}

export class PgConfigRepo implements ConfigRepo {
  readonly persistent = true;
  constructor(private readonly pool: pg.Pool) {}

  async getUserByName(username: string) {
    const r = await this.pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    const row = r.rows[0];
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : null;
  }
  async upsertUser(username: string, passwordHash: string) {
    const r = await this.pool.query(
      `INSERT INTO users(username, password_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING id, username, password_hash`,
      [username, passwordHash],
    );
    const row = r.rows[0];
    return { id: row.id, username: row.username, passwordHash: row.password_hash };
  }
  async countUsers() {
    const r = await this.pool.query('SELECT count(*)::int AS c FROM users');
    return r.rows[0].c as number;
  }
  async createSession(tokenHash: string, userId: number, expiresAt: Date) {
    await this.pool.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [tokenHash, userId, expiresAt]);
  }
  async getSession(tokenHash: string) {
    const r = await this.pool.query(
      'SELECT s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash],
    );
    const row = r.rows[0];
    return row ? { userId: row.user_id, username: row.username, expiresAt: row.expires_at } : null;
  }
  async deleteSession(tokenHash: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
  async purgeSessions() {
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
  }
  async listTokens() {
    const r = await this.pool.query('SELECT * FROM ingest_tokens ORDER BY id');
    return r.rows.map(tokenRow);
  }
  async createToken(name: string, kind: 'nt8' | 'robot', tokenHash: string) {
    const r = await this.pool.query('INSERT INTO ingest_tokens(name, kind, token_hash) VALUES ($1,$2,$3) RETURNING *', [name, kind, tokenHash]);
    return tokenRow(r.rows[0]);
  }
  async revokeToken(id: number) {
    await this.pool.query('UPDATE ingest_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  }
  async findToken(tokenHash: string) {
    const r = await this.pool.query('SELECT * FROM ingest_tokens WHERE token_hash = $1', [tokenHash]);
    return r.rows[0] ? tokenRow(r.rows[0]) : null;
  }
  async touchToken(id: number) {
    await this.pool.query('UPDATE ingest_tokens SET last_used_at = now() WHERE id = $1', [id]);
  }
  async listRooms(mode: Mode) {
    const r = await this.pool.query('SELECT mode, id, name, sort FROM rooms WHERE mode = $1 ORDER BY sort, id', [mode]);
    return r.rows as Room[];
  }
  async upsertRoom(room: Room) {
    await this.pool.query(
      'INSERT INTO rooms(mode, id, name, sort) VALUES ($1,$2,$3,$4) ON CONFLICT (mode, id) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort',
      [room.mode, room.id, room.name, room.sort],
    );
  }
  async deleteRoom(mode: Mode, id: string) {
    await this.pool.query('DELETE FROM rooms WHERE mode = $1 AND id = $2', [mode, id]);
  }
  async listAccounts(mode: Mode): Promise<AccountConfig[]> {
    const r = await this.pool.query('SELECT * FROM accounts WHERE mode = $1', [mode]);
    return r.rows.map((x) => ({
      id: x.id,
      mode: x.mode,
      name: x.name,
      displayName: x.display_name,
      roomId: x.room_id,
      deskIndex: x.desk_index,
      platform: x.platform,
      provider: x.provider,
      connectionName: x.connection_name,
      firm: x.firm,
      plan: x.plan,
      nominalSize: n(x.nominal_size),
      startingBalance: n(x.starting_balance),
      rule: { ...DEFAULT_RULE, ...x.rule },
      riskState: { ...EMPTY_RISK_STATE, ...x.risk_state },
      hidden: x.hidden,
    }));
  }
  async upsertAccount(a: AccountConfig) {
    await this.pool.query(
      `INSERT INTO accounts(mode, id, name, display_name, room_id, desk_index, platform, provider, connection_name, firm, plan,
         nominal_size, starting_balance, rule, risk_state, hidden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (mode, id) DO UPDATE SET name = EXCLUDED.name, display_name = EXCLUDED.display_name, room_id = EXCLUDED.room_id,
         desk_index = EXCLUDED.desk_index, platform = EXCLUDED.platform, provider = EXCLUDED.provider,
         connection_name = EXCLUDED.connection_name, firm = EXCLUDED.firm, plan = EXCLUDED.plan, nominal_size = EXCLUDED.nominal_size,
         starting_balance = EXCLUDED.starting_balance, rule = EXCLUDED.rule, risk_state = EXCLUDED.risk_state, hidden = EXCLUDED.hidden,
         updated_at = now()`,
      [
        a.mode, a.id, a.name, a.displayName, a.roomId, a.deskIndex, a.platform, a.provider, a.connectionName, a.firm, a.plan,
        a.nominalSize, a.startingBalance, JSON.stringify(a.rule), JSON.stringify(a.riskState), a.hidden,
      ],
    );
  }
  async deleteAccount(mode: Mode, id: string) {
    await this.pool.query('DELETE FROM accounts WHERE mode = $1 AND id = $2', [mode, id]);
  }
}

/** Dados LIVE persistidos. Não existe PgDataRepo para DEMO por construção. */
export class PgLiveDataRepo implements DataRepo {
  readonly persistent = true;
  constructor(private readonly pool: pg.Pool) {}

  async insertExecution(e: ExecutionRecord) {
    if (e.mode !== 'live') throw new Error('PgLiveDataRepo aceita somente dados LIVE');
    const r = await this.pool.query(
      `INSERT INTO executions(account_id, exec_id, ts, instrument, side, quantity, price, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [e.accountId, e.execId, new Date(e.ts), e.instrument, e.side, e.quantity, e.price, e.orderId],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async listExecutions(accountId: string, from: number, to: number, limit: number) {
    const r = await this.pool.query(
      'SELECT * FROM executions WHERE account_id = $1 AND ts BETWEEN $2 AND $3 ORDER BY ts DESC LIMIT $4',
      [accountId, new Date(from), new Date(to), limit],
    );
    return r.rows.map(
      (x): ExecutionRecord => ({
        execId: x.exec_id,
        accountId: x.account_id,
        mode: 'live',
        ts: x.ts.getTime(),
        instrument: x.instrument,
        side: x.side,
        quantity: x.quantity,
        price: x.price,
        orderId: x.order_id,
      }),
    );
  }
  async insertEquityPoint(accountId: string, p: EquityPoint) {
    await this.pool.query(
      `INSERT INTO equity_points(account_id, ts, balance, equity, realized, unrealized) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, ts) DO NOTHING`,
      [accountId, new Date(p.ts), p.balance, p.equity, p.realized, p.unrealized],
    );
  }
  async listEquity(accountId: string, from: number, to: number, maxPoints: number) {
    const r = await this.pool.query(
      'SELECT ts, balance, equity, realized, unrealized FROM equity_points WHERE account_id = $1 AND ts BETWEEN $2 AND $3 ORDER BY ts LIMIT 200000',
      [accountId, new Date(from), new Date(to)],
    );
    return downsample(
      r.rows.map((x): EquityPoint => ({ ts: x.ts.getTime(), balance: x.balance, equity: x.equity, realized: x.realized, unrealized: x.unrealized })),
      maxPoints,
    );
  }
  async insertEvent(e: ActivityEvent) {
    if (e.mode !== 'live') throw new Error('PgLiveDataRepo aceita somente dados LIVE');
    const r = await this.pool.query(
      `INSERT INTO activity_events(id, ts, kind, type, account_id, severity, message, confirmed, correlated_execution_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [e.id, new Date(e.ts), e.kind, e.type, e.accountId, e.severity, e.message, e.confirmed, e.correlatedExecutionId, JSON.stringify(e.payload)],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async listEvents(opts: { accountId?: string; from?: number; to?: number; limit: number }) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.accountId) where.push(`account_id = $${args.push(opts.accountId)}`);
    if (opts.from != null) where.push(`ts >= $${args.push(new Date(opts.from))}`);
    if (opts.to != null) where.push(`ts <= $${args.push(new Date(opts.to))}`);
    const sql = `SELECT * FROM activity_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT $${args.push(opts.limit)}`;
    const r = await this.pool.query(sql, args);
    return r.rows.map(
      (x): ActivityEvent => ({
        id: x.id,
        mode: 'live',
        ts: x.ts.getTime(),
        kind: x.kind,
        type: x.type,
        accountId: x.account_id,
        severity: x.severity,
        message: x.message,
        confirmed: x.confirmed,
        correlatedExecutionId: x.correlated_execution_id,
        payload: x.payload,
      }),
    );
  }
}
