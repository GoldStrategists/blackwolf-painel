import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import {
  PLAN_TEMPLATES,
  accountCreateSchema,
  accountPatchSchema,
  collectorPayloadSchema,
  historyQuerySchema,
  loginSchema,
  robotEventSchema,
  roomInputSchema,
  tokenCreateSchema,
  type ClientMessage,
  type Mode,
  type ServerMessage,
} from '@bw/shared';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { ConfigRepo, DataRepo } from './db/repo.js';
import { ModeEngine } from './engine.js';
import type { HubClient } from './hub.js';
import { DUMMY_HASH, hashPassword, newToken, sha256, verifyPassword } from './security.js';

export const SESSION_COOKIE = 'bw_session';
const MODES: Mode[] = ['demo', 'live'];

export interface AppDeps {
  config: AppConfig;
  configRepo: ConfigRepo;
  liveData: DataRepo;
  demoData: DataRepo;
  logger?: boolean | object;
  now?: () => number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: number; username: string };
    ingestToken?: { id: number; name: string; kind: 'nt8' | 'robot' };
  }
}

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

export async function buildApp(deps: AppDeps) {
  const { config, configRepo } = deps;
  const app = Fastify({
    logger:
      deps.logger ??
      ({
        level: 'info',
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token'],
          censor: '[oculto]',
        },
      } as object),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
    ...(config.tls ? { https: config.tls } : {}),
  });

  const engineOpts = { staleAfterMs: config.staleAfterMs, persistEveryMs: 15_000, now: deps.now };
  const engines: Record<Mode, ModeEngine> = {
    live: new ModeEngine('live', configRepo, deps.liveData, engineOpts),
    demo: new ModeEngine('demo', configRepo, deps.demoData, { ...engineOpts, persistEveryMs: 5000 }),
  };
  await engines.live.init();
  await engines.demo.init();

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  // ---------------------------------------------------------------- cabeçalhos
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (_req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // Bloqueia requisições mutáveis vindas de outras origens (CSRF), além do cookie SameSite=Strict.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (req.url.startsWith('/api/ingest/')) return; // autenticado por token Bearer, sem cookie
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'Origem não permitida' });
  });

  // ---------------------------------------------------------------- auth helpers
  async function sessionFrom(req: FastifyRequest) {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw || raw.length > 200) return null;
    const s = await configRepo.getSession(sha256(raw));
    if (!s || s.expiresAt.getTime() < Date.now()) return null;
    return { id: s.userId, username: s.username };
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const user = await sessionFrom(req);
    if (!user) return reply.code(401).send({ error: 'Não autenticado' });
    req.user = user;
  }

  const requireIngest = (kind: 'nt8' | 'robot') => async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token || token.length > 200) return reply.code(401).send({ error: 'Token ausente' });
    const row = await configRepo.findToken(sha256(token));
    if (!row || row.revokedAt || row.kind !== kind) return reply.code(401).send({ error: 'Token inválido' });
    req.ingestToken = { id: row.id, name: row.name, kind: row.kind };
    void configRepo.touchToken(row.id);
  };

  const modeParam = z.object({ mode: z.enum(['demo', 'live']) });
  const engineFor = (req: FastifyRequest) => engines[modeParam.parse(req.params).mode];

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Dados inválidos', issues: err.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: { message: err.message, stack: err.stack } }, 'erro interno');
    return reply.code(status).send({ error: status >= 500 ? 'Erro interno' : err.message });
  });

  // ---------------------------------------------------------------- rotas públicas
  app.get('/api/health', async () => ({ ok: true, service: 'blackwolf-trading-floor', persistent: configRepo.persistent }));

  app.get('/api/auth/me', async (req) => {
    const user = await sessionFrom(req);
    const users = await configRepo.countUsers();
    return { user, needsSetup: users === 0, setupAllowed: users === 0 && isLoopback(req.ip) };
  });

  app.post('/api/auth/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    // Primeiro acesso: só do próprio computador e só se ainda não existe usuário.
    if (!isLoopback(req.ip)) return reply.code(403).send({ error: 'Configuração inicial só pelo próprio computador' });
    if ((await configRepo.countUsers()) > 0) return reply.code(409).send({ error: 'Usuário já configurado' });
    const body = loginSchema.parse(req.body);
    if (body.password.length < 10) return reply.code(400).send({ error: 'Use uma senha com pelo menos 10 caracteres' });
    await configRepo.upsertUser(body.username, await hashPassword(body.password));
    return { ok: true };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await configRepo.getUserByName(body.username);
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      req.log.warn({ ip: req.ip }, 'login recusado');
      return reply.code(401).send({ error: 'Usuário ou senha inválidos' });
    }
    const token = newToken('bws');
    const expires = new Date(Date.now() + config.sessionTtlMs);
    await configRepo.createSession(sha256(token), user.id, expires);
    void configRepo.purgeSessions();
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!config.tls,
      path: '/',
      expires,
    });
    return { user: { id: user.id, username: user.username } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await configRepo.deleteSession(sha256(raw));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------------------------------------------------------------- ingestão
  app.post(
    '/api/ingest/nt8',
    { preHandler: requireIngest('nt8'), config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } },
    async (req) => {
      const payload = collectorPayloadSchema.parse(req.body);
      const r = await engines.live.ingest(payload, 'nt8');
      return { ok: true, ackSeq: payload.seq, duplicate: r.reason === 'duplicate', newExecutions: r.newExecutions, serverTime: new Date().toISOString() };
    },
  );

  app.post(
    '/api/ingest/robot',
    { preHandler: requireIngest('robot'), config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req) => {
      const q = z.object({ target: z.enum(['live', 'demo']).default('live') }).parse(req.query);
      const items = z.union([robotEventSchema, z.array(robotEventSchema).max(200)]).parse(req.body);
      const list = Array.isArray(items) ? items : [items];
      let accepted = 0;
      for (const ev of list) if ((await engines[q.target].ingestRobot(ev, `t${req.ingestToken!.id}`)).accepted) accepted++;
      return { ok: true, accepted, duplicates: list.length - accepted };
    },
  );

  // ---------------------------------------------------------------- rotas autenticadas
  await app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    r.get('/api/meta', async () => ({ plans: PLAN_TEMPLATES, persistent: configRepo.persistent, modes: MODES }));

    r.get('/api/:mode/state', async (req) => engineFor(req).snapshot());

    r.get('/api/:mode/accounts/:id/history', async (req, reply) => {
      const eng = engineFor(req);
      const { id } = z.object({ id: z.string().max(200) }).parse(req.params);
      if (!eng.getAccount(id)) return reply.code(404).send({ error: 'Conta não encontrada' });
      const q = historyQuerySchema.parse(req.query);
      const to = q.to ?? Date.now();
      const from = q.from ?? to - 86400_000;
      const [equity, executions, events] = await Promise.all([
        eng.data.listEquity(id, from, to, 600),
        eng.data.listExecutions(id, from, to, 500),
        eng.data.listEvents({ accountId: id, from, to, limit: 300 }),
      ]);
      return { from, to, equity, executions, events };
    });

    r.get('/api/:mode/events', async (req) => {
      const q = z
        .object({ accountId: z.string().max(200).optional(), from: z.coerce.number().optional(), to: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) })
        .parse(req.query);
      return engineFor(req).data.listEvents(q);
    });

    r.get('/api/:mode/accounts', async (req) => engineFor(req).listConfigs());

    r.post('/api/:mode/accounts', async (req, reply) => {
      try {
        return await engineFor(req).createAccount(accountCreateSchema.parse(req.body));
      } catch (e) {
        if (e instanceof z.ZodError) throw e;
        return reply.code(409).send({ error: (e as Error).message });
      }
    });

    r.patch('/api/:mode/accounts/:id', async (req, reply) => {
      const { id } = z.object({ id: z.string().max(200) }).parse(req.params);
      const patch = accountPatchSchema.parse(req.body);
      try {
        const res = await engineFor(req).patchAccount(id, patch);
        if (!res) return reply.code(404).send({ error: 'Conta não encontrada' });
        return res;
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

    r.delete('/api/:mode/accounts/:id', async (req, reply) => {
      const { id } = z.object({ id: z.string().max(200) }).parse(req.params);
      if (!(await engineFor(req).deleteAccount(id))) return reply.code(404).send({ error: 'Conta não encontrada' });
      return { ok: true };
    });

    r.put('/api/:mode/rooms/:id', async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = roomInputSchema.parse({ ...(req.body as object), id });
      await engineFor(req).upsertRoom(body);
      return { ok: true };
    });

    r.delete('/api/:mode/rooms/:id', async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      try {
        await engineFor(req).deleteRoom(id);
        return { ok: true };
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    });

    r.post('/api/:mode/rooms/:id/order', async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { ids } = z.object({ ids: z.array(z.string().max(200)).max(1000) }).parse(req.body);
      await engineFor(req).reorderRoom(id, ids);
      return { ok: true };
    });

    r.get('/api/tokens', async () => configRepo.listTokens());

    r.post('/api/tokens', async (req) => {
      const body = tokenCreateSchema.parse(req.body);
      const token = newToken(body.kind === 'nt8' ? 'bwc' : 'bwr');
      const row = await configRepo.createToken(body.name, body.kind, sha256(token));
      // O token em texto só é mostrado UMA vez.
      return { ...row, token };
    });

    r.delete('/api/tokens/:id', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
      await configRepo.revokeToken(id);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- WebSocket
  app.get('/ws', { websocket: true, preValidation: async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'Origem não permitida' });
    await requireUser(req, reply);
  } }, (socket: WebSocket, req) => {
    let engine: ModeEngine | null = null;
    let lastSeen = Date.now();
    const client: HubClient = {
      send(msg: ServerMessage) {
        if (socket.readyState !== socket.OPEN) throw new Error('closed');
        // Cliente lento demais: derruba; ele reconecta e recebe snapshot.
        if (socket.bufferedAmount > 8 * 1024 * 1024) {
          socket.terminate();
          throw new Error('slow consumer');
        }
        socket.send(JSON.stringify(msg));
      },
    };
    const send = (m: ServerMessage) => {
      try {
        client.send(m);
      } catch {
        /* conexão já fechada */
      }
    };

    const ping = setInterval(() => {
      if (Date.now() - lastSeen > 20_000) {
        socket.terminate();
        return;
      }
      send({ t: 'ping', serverTime: Date.now() });
    }, 5000);

    socket.on('message', (data: Buffer) => {
      lastSeen = Date.now();
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.t === 'ping' && typeof msg.clientTs === 'number') send({ t: 'pong', clientTs: msg.clientTs, serverTime: Date.now() });
      else if (msg.t === 'subscribe' && (msg.mode === 'demo' || msg.mode === 'live')) {
        engine?.hub.remove(client);
        engine = engines[msg.mode];
        send({ t: 'hello', mode: engine.mode, serverTime: Date.now(), epoch: engine.hub.epoch });
        const replay = engine.hub.replaySince(msg.epoch, msg.lastSeq);
        if (replay) for (const m of replay) send(m);
        else send(engine.snapshot());
        engine.hub.add(client);
      }
    });
    socket.on('close', () => {
      clearInterval(ping);
      engine?.hub.remove(client);
    });
    req.log.info('websocket conectado');
  });

  // ---------------------------------------------------------------- frontend compilado
  const staticDir = resolve(process.cwd(), config.staticDir ?? '../web/dist');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'Não encontrado' });
      return reply.sendFile('index.html');
    });
  }

  return { app, engines };
}
