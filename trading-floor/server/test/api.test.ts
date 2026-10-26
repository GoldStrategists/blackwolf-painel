import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { InjectOptions } from 'fastify';
import type { ServerMessage } from '@bw/shared';
import { buildApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryConfigRepo, MemoryDataRepo } from '../src/db/memory.js';
import { hashPassword, sha256 } from '../src/security.js';
import { account, payload } from './helpers.js';

const config = { ...loadConfig({ HOST: '127.0.0.1', PORT: '0' } as NodeJS.ProcessEnv), staticDir: '/nonexistent' };
const configRepo = new MemoryConfigRepo();
let built: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let nt8Token = '';
let robotToken = '';
let port = 0;

beforeAll(async () => {
  await configRepo.upsertUser('admin', await hashPassword('senha-de-teste-123'));
  built = await buildApp({ config, configRepo, liveData: new MemoryDataRepo(), demoData: new MemoryDataRepo(), logger: false });
  await built.app.listen({ host: '127.0.0.1', port: 0 });
  port = (built.app.server.address() as { port: number }).port;
});
afterAll(async () => {
  await built.app.close();
});

const inject = (opts: InjectOptions) => built.app.inject(opts);

describe('autenticação', () => {
  it('bloqueia rotas sem sessão', async () => {
    expect((await inject({ method: 'GET', url: '/api/live/state' })).statusCode).toBe(401);
    expect((await inject({ method: 'GET', url: '/api/tokens' })).statusCode).toBe(401);
  });

  it('recusa senha errada sem revelar se o usuário existe', async () => {
    const a = await inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'errada' } });
    const b = await inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'naoexiste', password: 'errada' } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error).toBe(b.json().error);
  });

  it('setup inicial é recusado quando já existe usuário', async () => {
    const r = await inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'x', password: 'outrasenha123' }, remoteAddress: '127.0.0.1' });
    expect(r.statusCode).toBe(409);
  });

  it('login cria cookie httpOnly + SameSite=Strict e a sessão é guardada só como hash', async () => {
    const r = await inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'senha-de-teste-123' } });
    expect(r.statusCode).toBe(200);
    const set = String(r.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    const raw = /bw_session=([^;]+)/.exec(set)![1]!;
    cookie = `${SESSION_COOKIE}=${raw}`;
    expect(await configRepo.getSession(raw)).toBeNull();
    expect(await configRepo.getSession(sha256(raw))).not.toBeNull();
  });

  it('bloqueia requisição mutável de outra origem (CSRF)', async () => {
    const r = await inject({ method: 'POST', url: '/api/tokens', headers: { cookie, origin: 'https://evil.example' }, payload: { name: 'x', kind: 'nt8' } });
    expect(r.statusCode).toBe(403);
  });

  it('cabeçalhos de segurança presentes', async () => {
    const r = await inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(String(r.headers['content-security-policy'])).toMatch(/frame-ancestors 'none'/);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('tokens e ingestão', () => {
  it('gera tokens (texto só uma vez; banco guarda hash)', async () => {
    const a = await inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'pc', kind: 'nt8' } });
    const b = await inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'robo', kind: 'robot' } });
    nt8Token = a.json().token;
    robotToken = b.json().token;
    expect(nt8Token).toMatch(/^bwc_/);
    expect(await configRepo.findToken(nt8Token)).toBeNull();
    const list = (await inject({ method: 'GET', url: '/api/tokens', headers: { cookie } })).json();
    expect(JSON.stringify(list)).not.toContain(nt8Token);
  });

  it('ingestão sem token, com token inválido ou do tipo errado é recusada', async () => {
    const body = payload(1, [account('APEX-1')]);
    expect((await inject({ method: 'POST', url: '/api/ingest/nt8', payload: body })).statusCode).toBe(401);
    expect((await inject({ method: 'POST', url: '/api/ingest/nt8', payload: body, headers: { authorization: 'Bearer bwc_falso' } })).statusCode).toBe(401);
    expect((await inject({ method: 'POST', url: '/api/ingest/nt8', payload: body, headers: { authorization: `Bearer ${robotToken}` } })).statusCode).toBe(401);
  });

  it('token do coletor não dá acesso de leitura', async () => {
    const r = await inject({ method: 'GET', url: '/api/live/state', headers: { authorization: `Bearer ${nt8Token}` } });
    expect(r.statusCode).toBe(401);
  });

  it('valida payload (400) e aceita payload correto', async () => {
    const bad = await inject({ method: 'POST', url: '/api/ingest/nt8', payload: { v: 1, accounts: 'x' }, headers: { authorization: `Bearer ${nt8Token}` } });
    expect(bad.statusCode).toBe(400);
    const ok = await inject({ method: 'POST', url: '/api/ingest/nt8', payload: payload(1, [account('APEX-1')]), headers: { authorization: `Bearer ${nt8Token}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ackSeq).toBe(1);
  });

  it('dados LIVE não aparecem no DEMO', async () => {
    const demo = (await inject({ method: 'GET', url: '/api/demo/state', headers: { cookie } })).json();
    expect(demo.accounts.find((a: { name: string }) => a.name === 'APEX-1')).toBeUndefined();
    const live = (await inject({ method: 'GET', url: '/api/live/state', headers: { cookie } })).json();
    expect(live.accounts.map((a: { name: string }) => a.name)).toContain('APEX-1');
  });

  it('robô: aceita lote, deduplica e nunca marca como confirmado', async () => {
    const ev = { eventId: 'r-1', type: 'signal', account: 'APEX-1', instrument: 'NQ', message: 'teste' };
    const r = await inject({ method: 'POST', url: '/api/ingest/robot', payload: [ev, ev], headers: { authorization: `Bearer ${robotToken}` } });
    expect(r.json()).toMatchObject({ accepted: 1, duplicates: 1 });
    const events = (await inject({ method: 'GET', url: '/api/live/events?limit=50', headers: { cookie } })).json();
    const robot = events.find((e: { kind: string }) => e.kind === 'robot');
    expect(robot.confirmed).toBe(false);
  });

  it('robô: tipo de evento desconhecido é recusado', async () => {
    const r = await inject({ method: 'POST', url: '/api/ingest/robot', payload: { eventId: 'x', type: 'buy_now' }, headers: { authorization: `Bearer ${robotToken}` } });
    expect(r.statusCode).toBe(400);
  });

  it('token revogado deixa de funcionar', async () => {
    const t = (await inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'tmp', kind: 'nt8' } })).json();
    await inject({ method: 'DELETE', url: `/api/tokens/${t.id}`, headers: { cookie } });
    const r = await inject({ method: 'POST', url: '/api/ingest/nt8', payload: payload(99, [account('APEX-1')]), headers: { authorization: `Bearer ${t.token}` } });
    expect(r.statusCode).toBe(401);
  });
});

describe('configuração', () => {
  it('PATCH valida campos e rejeita campos desconhecidos', async () => {
    const bad = await inject({ method: 'PATCH', url: '/api/live/accounts/nt8:APEX-1', headers: { cookie }, payload: { balance: 1e9 } });
    expect(bad.statusCode).toBe(400);
    const ok = await inject({ method: 'PATCH', url: '/api/live/accounts/nt8:APEX-1', headers: { cookie }, payload: { displayName: 'Mesa 1', nominalSize: 50000 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().displayName).toBe('Mesa 1');
  });

  it('salas: criar, recusar excluir sala com contas', async () => {
    expect((await inject({ method: 'PUT', url: '/api/live/rooms/sala-5', headers: { cookie }, payload: { name: 'SALA 5', sort: 5 } })).statusCode).toBe(200);
    expect((await inject({ method: 'PUT', url: '/api/live/rooms/Inválida!', headers: { cookie }, payload: { name: 'x', sort: 1 } })).statusCode).toBe(400);
    expect((await inject({ method: 'DELETE', url: '/api/live/rooms/apex-rithmic', headers: { cookie } })).statusCode).toBe(409);
    expect((await inject({ method: 'DELETE', url: '/api/live/rooms/sala-5', headers: { cookie } })).statusCode).toBe(200);
  });

  it('histórico de conta inexistente → 404', async () => {
    expect((await inject({ method: 'GET', url: '/api/live/accounts/nt8:NAO/history', headers: { cookie } })).statusCode).toBe(404);
  });
});

describe('WebSocket', () => {
  const open = (headers: Record<string, string>) =>
    new Promise<{ ws: WebSocket; msgs: ServerMessage[] }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      const msgs: ServerMessage[] = [];
      ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
      ws.on('open', () => resolve({ ws, msgs }));
      ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on('error', reject);
    });
  const until = async (fn: () => boolean, ms = 3000) => {
    const t = Date.now();
    while (!fn()) {
      if (Date.now() - t > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it('recusa conexão sem sessão', async () => {
    await expect(open({})).rejects.toThrow(/401/);
  });

  it('recusa conexão de outra origem', async () => {
    await expect(open({ cookie, origin: 'https://evil.example' })).rejects.toThrow(/403/);
  });

  it('snapshot, atualização incremental e retomada sem perda após reconexão', async () => {
    const a = await open({ cookie });
    a.ws.send(JSON.stringify({ t: 'subscribe', mode: 'live' }));
    await until(() => a.msgs.some((m) => m.t === 'snapshot'));
    const snap = a.msgs.find((m) => m.t === 'snapshot') as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(snap.accounts.map((x) => x.name)).toContain('APEX-1');

    // Atualização incremental chega como 'account'
    await inject({ method: 'POST', url: '/api/ingest/nt8', payload: payload(2, [account('APEX-1', { items: { CashValue: 50750, RealizedProfitLoss: 750, UnrealizedProfitLoss: 0 } })]), headers: { authorization: `Bearer ${nt8Token}` } });
    await until(() => a.msgs.some((m) => m.t === 'account' && m.account.balance === 50750));
    const lastSeq = Math.max(...a.msgs.filter((m): m is Extract<ServerMessage, { seq: number }> => 'seq' in m).map((m) => m.seq));
    a.ws.close();

    // Enquanto desconectado, chegam novos dados
    await inject({ method: 'POST', url: '/api/ingest/nt8', payload: payload(3, [account('APEX-1', { items: { CashValue: 50900, RealizedProfitLoss: 900, UnrealizedProfitLoss: 0 } })]), headers: { authorization: `Bearer ${nt8Token}` } });

    // Reconecta pedindo só o que perdeu
    const b = await open({ cookie });
    b.ws.send(JSON.stringify({ t: 'subscribe', mode: 'live', epoch: snap.epoch, lastSeq }));
    await until(() => b.msgs.some((m) => m.t === 'account' && m.account.balance === 50900));
    expect(b.msgs.some((m) => m.t === 'snapshot')).toBe(false);
    const seqs = b.msgs.filter((m): m is Extract<ServerMessage, { seq: number }> => 'seq' in m).map((m) => m.seq);
    expect(seqs[0]).toBe(lastSeq + 1);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));

    // Ping/pong para medir latência
    b.ws.send(JSON.stringify({ t: 'ping', clientTs: 123 }));
    await until(() => b.msgs.some((m) => m.t === 'pong' && m.clientTs === 123));
    b.ws.close();
  });
});
