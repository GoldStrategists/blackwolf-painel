import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { DemoSimulator } from './demo.js';
import { openStorage } from './storage.js';

const config = loadConfig();
const storage = await openStorage(config);
const { app, engines } = await buildApp({ config, ...storage });

if (!storage.configRepo.persistent) {
  app.log.warn('DATABASE_URL não definido: rodando EM MEMÓRIA. Configurações, usuários e histórico serão perdidos ao reiniciar.');
}

let demo: DemoSimulator | null = null;
if (config.demoEnabled) {
  demo = new DemoSimulator(engines.demo, Date.now, Number(process.env.BW_DEMO_ACCOUNTS || 20));
  await demo.seed();
  demo.start(1000);
}

const tick = setInterval(() => {
  void engines.live.tick().catch((err) => app.log.error({ err: { message: (err as Error).message } }, 'tick live'));
  void engines.demo.tick().catch((err) => app.log.error({ err: { message: (err as Error).message } }, 'tick demo'));
}, 1000);

await app.listen({ host: config.host, port: config.port });
app.log.info(`Black Wolf Trading Floor em ${config.tls ? 'https' : 'http'}://${config.host}:${config.port}`);

const shutdown = async () => {
  clearInterval(tick);
  demo?.stop();
  await app.close();
  await storage.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
