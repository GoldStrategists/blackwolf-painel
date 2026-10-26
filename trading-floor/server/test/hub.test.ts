import { describe, expect, it } from 'vitest';
import { Hub } from '../src/hub.js';

describe('Hub (sequência e replay)', () => {
  const ev = (n: number) => ({ t: 'account_removed' as const, mode: 'live' as const, id: `a${n}` });
  it('reenvia só o que o cliente perdeu', () => {
    const hub = new Hub(10);
    for (let i = 0; i < 5; i++) hub.publish(ev(i));
    const r = hub.replaySince(hub.epoch, 3)!;
    expect(r.map((m) => m.seq)).toEqual([4, 5]);
    expect(hub.replaySince(hub.epoch, 5)).toEqual([]);
  });
  it('pede snapshot se a lacuna saiu do buffer', () => {
    const hub = new Hub(3);
    for (let i = 0; i < 10; i++) hub.publish(ev(i));
    expect(hub.replaySince(hub.epoch, 2)).toBeNull();
    expect(hub.replaySince(hub.epoch, 7)!.map((m) => m.seq)).toEqual([8, 9, 10]);
  });
  it('pede snapshot se o servidor reiniciou (epoch diferente) ou seq no futuro', () => {
    const hub = new Hub();
    hub.publish(ev(1));
    expect(hub.replaySince('outro', 1)).toBeNull();
    expect(hub.replaySince(hub.epoch, 99)).toBeNull();
    expect(hub.replaySince(hub.epoch, undefined)).toBeNull();
  });
});
