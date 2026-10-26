import type { AppConfig } from './config.js';
import { MemoryConfigRepo, MemoryDataRepo } from './db/memory.js';
import { PgConfigRepo, PgLiveDataRepo, createPool, migrate } from './db/pg.js';
import type { ConfigRepo, DataRepo } from './db/repo.js';

export interface Storage {
  configRepo: ConfigRepo;
  liveData: DataRepo;
  demoData: DataRepo;
  close(): Promise<void>;
}

/** PostgreSQL quando DATABASE_URL existe; senão tudo em memória (aviso no log). */
export async function openStorage(config: AppConfig): Promise<Storage> {
  // DEMO SEMPRE em memória: dados fictícios nunca tocam as tabelas financeiras.
  const demoData = new MemoryDataRepo();
  if (!config.databaseUrl) {
    return { configRepo: new MemoryConfigRepo(), liveData: new MemoryDataRepo(), demoData, close: async () => undefined };
  }
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  return { configRepo: new PgConfigRepo(pool), liveData: new PgLiveDataRepo(pool), demoData, close: () => pool.end() };
}
