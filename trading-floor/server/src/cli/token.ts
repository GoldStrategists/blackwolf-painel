import { loadConfig } from '../config.js';
import { newToken, sha256 } from '../security.js';
import { openStorage } from '../storage.js';
import { arg } from './args.js';

// Uso: npm run token:create -- --name pc-ninjatrader --kind nt8   (ou --kind robot)
const name = arg('name') ?? 'ninjatrader';
const kind = (arg('kind') ?? 'nt8') as 'nt8' | 'robot';
if (kind !== 'nt8' && kind !== 'robot') throw new Error('--kind deve ser nt8 ou robot');
const config = loadConfig();
if (!config.databaseUrl) {
  console.error('Sem DATABASE_URL o token seria perdido ao reiniciar. Configure o banco ou crie o token pela tela de Configurações.');
  process.exit(1);
}
const storage = await openStorage(config);
const token = newToken(kind === 'nt8' ? 'bwc' : 'bwr');
await storage.configRepo.createToken(name, kind, sha256(token));
console.log(`Token "${name}" (${kind}) criado. Ele NÃO será mostrado de novo:\n\n${token}\n`);
await storage.close();
