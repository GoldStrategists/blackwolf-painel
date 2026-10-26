import type { ServerMessage } from '@bw/shared';
import { randomId } from './security.js';

type Sequenced = Extract<ServerMessage, { seq: number }>;
type Unsequenced<T> = T extends { seq: number } ? Omit<T, 'seq'> : never;
export type Publishable = Unsequenced<Sequenced>;

export interface HubClient {
  send(msg: ServerMessage): void;
}

/**
 * Canal de eventos de UM modo (demo ou live). Cada mensagem recebe um número de sequência
 * crescente; um cliente que reconecta informa (epoch, lastSeq) e recebe só o que perdeu —
 * ou um snapshot completo se a lacuna não couber no buffer ou o servidor reiniciou.
 */
export class Hub {
  readonly epoch = randomId();
  private seq = 0;
  private ring: Sequenced[] = [];
  private clients = new Set<HubClient>();

  constructor(private readonly capacity = 5000) {}

  get currentSeq() {
    return this.seq;
  }

  get clientCount() {
    return this.clients.size;
  }

  add(client: HubClient) {
    this.clients.add(client);
  }

  remove(client: HubClient) {
    this.clients.delete(client);
  }

  publish(msg: Publishable): Sequenced {
    const full = { ...msg, seq: ++this.seq } as Sequenced;
    this.ring.push(full);
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
    for (const c of this.clients) {
      try {
        c.send(full);
      } catch {
        this.clients.delete(c);
      }
    }
    return full;
  }

  /** Mensagens após lastSeq, ou null se for preciso snapshot completo. */
  replaySince(epoch: string | undefined, lastSeq: number | undefined): Sequenced[] | null {
    if (epoch !== this.epoch || lastSeq == null || lastSeq > this.seq) return null;
    if (lastSeq === this.seq) return [];
    const first = this.ring[0];
    if (!first || first.seq > lastSeq + 1) return null;
    return this.ring.filter((m) => m.seq > lastSeq);
  }
}
