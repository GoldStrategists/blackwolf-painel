import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULE, EMPTY_RISK_STATE } from '@bw/shared';
import { PgConfigRepo, PgLiveDataRepo, createPool, migrate } from '../src/db/pg.js';

// Integração com PostgreSQL real. Rode com TEST_DATABASE_URL apontando para um banco DESCARTÁVEL.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PostgreSQL', () => {
  const pool = createPool(url ?? '');
  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('migração é idempotente', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('configuração de conta separada por modo', async () => {
    const repo = new PgConfigRepo(pool);
    const acc = {
      id: 'nt8:A', mode: 'live' as const, name: 'A', displayName: 'A', roomId: 'apex-rithmic', deskIndex: 0, platform: 'NinjaTrader 8',
      provider: 'Rithmic', connectionName: null, firm: 'Apex', plan: null, nominalSize: 50000, startingBalance: 50000,
      rule: { ...DEFAULT_RULE, type: 'static' as const, maxDrawdown: 2000 }, riskState: EMPTY_RISK_STATE, hidden: false,
    };
    await repo.upsertAccount(acc);
    await repo.upsertAccount({ ...acc, mode: 'demo', displayName: 'demo' });
    const live = await repo.listAccounts('live');
    expect(live).toHaveLength(1);
    expect(live[0]!.nominalSize).toBe(50000);
    expect(live[0]!.rule.maxDrawdown).toBe(2000);
    expect((await repo.listAccounts('demo'))[0]!.displayName).toBe('demo');
  });

  it('execuções: ON CONFLICT impede duplicidade', async () => {
    const data = new PgLiveDataRepo(pool);
    const e = { execId: 'X', accountId: 'nt8:A', mode: 'live' as const, ts: Date.now(), instrument: 'NQ', side: 'buy' as const, quantity: 1, price: 1, orderId: null };
    expect(await data.insertExecution(e)).toBe(true);
    expect(await data.insertExecution(e)).toBe(false);
    expect(await data.listExecutions('nt8:A', 0, Date.now() + 1000, 10)).toHaveLength(1);
  });

  it('repositório LIVE recusa gravar dados DEMO', async () => {
    const data = new PgLiveDataRepo(pool);
    await expect(
      data.insertExecution({ execId: 'Y', accountId: 'demo:A', mode: 'demo', ts: Date.now(), instrument: 'NQ', side: 'buy', quantity: 1, price: 1, orderId: null }),
    ).rejects.toThrow(/LIVE/);
  });

  it('sessões e tokens', async () => {
    const repo = new PgConfigRepo(pool);
    const u = await repo.upsertUser('admin', 'hash');
    await repo.createSession('h1', u.id, new Date(Date.now() + 60_000));
    expect((await repo.getSession('h1'))?.username).toBe('admin');
    const t = await repo.createToken('pc', 'nt8', 'th');
    expect((await repo.findToken('th'))?.id).toBe(t.id);
    await repo.revokeToken(t.id);
    expect((await repo.findToken('th'))?.revokedAt).not.toBeNull();
  });
});
