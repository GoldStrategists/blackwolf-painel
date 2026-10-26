import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { hashPassword } from '../security.js';
import { openStorage } from '../storage.js';
import { arg } from './args.js';

// Uso: npm run user:set-password -- --user admin   (a senha é pedida no terminal)
const config = loadConfig();
const user = arg('user') ?? config.adminUser;
if (!config.databaseUrl) {
  console.error('Defina DATABASE_URL: sem banco a senha não persiste. Sem banco, use a tela de primeiro acesso.');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pw = process.env.BW_NEW_PASSWORD ?? (await rl.question(`Nova senha para "${user}" (mín. 10 caracteres): `));
rl.close();
if (pw.length < 10) {
  console.error('Senha muito curta.');
  process.exit(1);
}
const storage = await openStorage(config);
await storage.configRepo.upsertUser(user, await hashPassword(pw));
console.log(`Senha de "${user}" definida.`);
await storage.close();
