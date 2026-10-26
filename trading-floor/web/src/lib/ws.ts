import type { ClientMessage, ServerMessage } from '@bw/shared';
import { useFloor } from './store';

/**
 * Cliente WebSocket com reconexão (backoff exponencial + jitter), heartbeat, medição de
 * latência (RTT) e ressincronização: ao reconectar pede só as mensagens perdidas
 * (epoch + último seq); se o servidor não tiver mais, ele manda snapshot completo.
 */
export class FloorSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;
  private unsubMode: (() => void) | null = null;
  private lastInbound = 0;
  private resyncing = false;

  constructor(private readonly onUnauthorized: () => void) {}

  start() {
    this.stopped = false;
    this.connect();
    this.unsubMode = useFloor.subscribe((s, prev) => {
      if (s.mode !== prev.mode) this.subscribe();
    });
  }

  stop() {
    this.stopped = true;
    this.unsubMode?.();
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  private clearTimers() {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
  }

  private connect() {
    if (this.stopped) return;
    useFloor.getState().setWs('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.attempt = 0;
      this.lastInbound = Date.now();
      useFloor.getState().setWs('open');
      this.subscribe();
      this.pingTimer = window.setInterval(() => {
        // Sem nada do servidor há 12s: conexão "zumbi" → derruba e reconecta.
        if (Date.now() - this.lastInbound > 12_000) {
          ws.close();
          return;
        }
        this.send({ t: 'ping', clientTs: performance.now() });
      }, 2000);
    };

    ws.onmessage = (ev) => {
      this.lastInbound = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        useFloor.getState().setRtt(Math.round(performance.now() - msg.clientTs));
        return;
      }
      if (msg.t === 'ping') {
        this.send({ t: 'pong', serverTime: msg.serverTime });
        useFloor.getState().apply(msg);
        return;
      }
      const r = useFloor.getState().apply(msg);
      if (r === 'ok') this.resyncing = false;
      else if (r === 'gap' && !this.resyncing) {
        this.resyncing = true;
        this.subscribe();
      }
    };

    ws.onclose = (ev) => {
      this.clearTimers();
      useFloor.getState().setWs('closed');
      if (this.stopped) return;
      // 1006 antes de abrir costuma ser 401 no upgrade (sessão expirada).
      if (!opened && this.attempt >= 1) {
        void fetch('/api/auth/me', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => {
            if (!d.user) this.onUnauthorized();
          })
          .catch(() => undefined);
      }
      const delay = Math.min(10_000, 500 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
      this.attempt++;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
      void ev;
    };
    ws.onerror = () => ws.close();
  }

  private subscribe() {
    this.resyncing = true;
    const s = useFloor.getState();
    this.send({ t: 'subscribe', mode: s.mode, epoch: s.epoch ?? undefined, lastSeq: s.ready ? s.seq : undefined });
  }

  private send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
