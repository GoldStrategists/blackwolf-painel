import { createPool, migrate } from '../db/pg.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL no arquivo .env');
  process.exit(1);
}
const pool = createPool(url);
const applied = await migrate(pool);
console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
await pool.end();
