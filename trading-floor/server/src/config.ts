import { readFileSync } from 'node:fs';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string | null;
  adminUser: string;
  sessionTtlMs: number;
  tls: { cert: Buffer; key: Buffer } | null;
  allowedOrigins: string[];
  /** Expor somente em testes: desliga o simulador para controle determinístico. */
  demoEnabled: boolean;
  staticDir: string | null;
  /** Segundos sem dados do coletor até a conta ser marcada como desatualizada. */
  staleAfterMs: number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 4100);
  const tls =
    env.TLS_CERT && env.TLS_KEY ? { cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY) } : null;

  if (!LOOPBACK.has(host) && !tls && env.ALLOW_INSECURE_LAN !== '1') {
    throw new Error(
      `HOST=${host} expõe o painel na rede sem criptografia. Configure TLS_CERT/TLS_KEY ` +
        `(ver docs/SEGURANCA.md) ou use HOST=127.0.0.1.`,
    );
  }

  const scheme = tls ? 'https' : 'http';
  const allowedOrigins = [
    `${scheme}://127.0.0.1:${port}`,
    `${scheme}://localhost:${port}`,
    // Vite dev server
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    ...(env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];

  return {
    host,
    port,
    databaseUrl: env.DATABASE_URL || null,
    adminUser: env.BW_ADMIN_USER || 'admin',
    sessionTtlMs: Number(env.SESSION_TTL_HOURS || 12) * 3600_000,
    tls,
    allowedOrigins,
    demoEnabled: env.BW_DISABLE_DEMO !== '1',
    staticDir: env.BW_STATIC_DIR ?? null,
    staleAfterMs: Number(env.BW_STALE_AFTER_MS || 5000),
  };
}
