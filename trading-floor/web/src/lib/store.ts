import { create } from 'zustand';
import type { AccountView, ActivityEvent, Mode, Room, ServerMessage, Summary } from '@bw/shared';
import { load, save } from './storage';

export type CameraMode = 'panorama' | 'top' | 'free' | 'focus';
export type Quality = 'low' | 'medium' | 'high';
export type WsState = 'connecting' | 'open' | 'closed';

interface FloorState {
  mode: Mode;
  ws: WsState;
  rttMs: number | null;
  lastMessageAt: number;
  epoch: string | null;
  seq: number;
  /** Dados prontos para o modo atual (snapshot recebido). */
  ready: boolean;
  accounts: Record<string, AccountView>;
  order: string[];
  rooms: Room[];
  summary: Summary | null;
  events: ActivityEvent[];
  selectedId: string | null;
  hoveredId: string | null;
  camera: CameraMode;
  cameraNonce: number;
  roomFilter: string;
  quality: Quality;
  feedOpen: boolean;
  settingsOpen: boolean;

  setMode(m: Mode): void;
  select(id: string | null): void;
  hover(id: string | null): void;
  setCamera(c: CameraMode): void;
  setRoomFilter(r: string): void;
  setQuality(q: Quality): void;
  setFeedOpen(v: boolean): void;
  setSettingsOpen(v: boolean): void;
  setWs(s: WsState): void;
  setRtt(ms: number): void;
  /** Aplica uma mensagem; devolve 'gap' se faltou alguma mensagem (precisa ressincronizar). */
  apply(msg: ServerMessage): 'ok' | 'gap' | 'ignored';
}

const MAX_EVENTS = 300;

function sortOrder(accounts: Record<string, AccountView>) {
  return Object.values(accounts)
    .sort((a, b) => a.roomId.localeCompare(b.roomId) || a.deskIndex - b.deskIndex || a.name.localeCompare(b.name))
    .map((a) => a.id);
}

export const useFloor = create<FloorState>((set, get) => ({
  mode: load<Mode>('bw.mode', 'demo') === 'live' ? 'live' : 'demo',
  ws: 'connecting',
  rttMs: null,
  lastMessageAt: 0,
  epoch: null,
  seq: 0,
  ready: false,
  accounts: {},
  order: [],
  rooms: [],
  summary: null,
  events: [],
  selectedId: null,
  hoveredId: null,
  camera: 'panorama',
  cameraNonce: 0,
  roomFilter: load('bw.room', 'all'),
  quality: load<Quality>('bw.quality', 'medium'),
  feedOpen: load('bw.feed', true),
  settingsOpen: false,

  setMode(mode) {
    if (mode === get().mode) return;
    save('bw.mode', mode);
    // Troca de modo descarta TUDO do modo anterior: nada de DEMO aparece no LIVE e vice-versa.
    set({ mode, ready: false, accounts: {}, order: [], rooms: [], summary: null, events: [], epoch: null, seq: 0, selectedId: null, roomFilter: 'all' });
  },
  select(id) {
    set((s) => ({ selectedId: id, camera: id ? 'focus' : s.camera === 'focus' ? 'panorama' : s.camera, cameraNonce: s.cameraNonce + 1 }));
  },
  hover(id) {
    if (get().hoveredId !== id) set({ hoveredId: id });
  },
  setCamera(camera) {
    set((s) => ({ camera, cameraNonce: s.cameraNonce + 1, selectedId: camera === 'focus' ? s.selectedId : null }));
  },
  setRoomFilter(roomFilter) {
    save('bw.room', roomFilter);
    set((s) => ({ roomFilter, camera: 'panorama', cameraNonce: s.cameraNonce + 1, selectedId: null }));
  },
  setQuality(quality) {
    save('bw.quality', quality);
    set({ quality });
  },
  setFeedOpen(feedOpen) {
    save('bw.feed', feedOpen);
    set({ feedOpen });
  },
  setSettingsOpen(settingsOpen) {
    set({ settingsOpen });
  },
  setWs(ws) {
    set({ ws });
  },
  setRtt(rttMs) {
    set({ rttMs, lastMessageAt: Date.now() });
  },

  apply(msg) {
    const s = get();
    const now = Date.now();
    if (msg.t === 'ping' || msg.t === 'pong' || msg.t === 'hello' || msg.t === 'error') {
      set({ lastMessageAt: now });
      return 'ok';
    }
    if (msg.mode !== s.mode) return 'ignored';

    if (msg.t === 'snapshot') {
      const accounts: Record<string, AccountView> = {};
      for (const a of msg.accounts) accounts[a.id] = a;
      set({
        ready: true,
        epoch: msg.epoch,
        seq: msg.seq,
        accounts,
        order: sortOrder(accounts),
        rooms: msg.rooms,
        summary: msg.summary,
        events: [...msg.events].sort((a, b) => b.ts - a.ts).slice(0, MAX_EVENTS),
        lastMessageAt: now,
      });
      return 'ok';
    }

    if (!s.ready) return 'ignored';
    if (msg.seq <= s.seq) return 'ignored'; // duplicada (replay sobreposto)
    if (msg.seq !== s.seq + 1) return 'gap';

    const patch: Partial<FloorState> = { seq: msg.seq, lastMessageAt: now };
    switch (msg.t) {
      case 'account': {
        const prev = s.accounts[msg.account.id];
        const accounts = { ...s.accounts, [msg.account.id]: msg.account };
        patch.accounts = accounts;
        if (!prev || prev.roomId !== msg.account.roomId || prev.deskIndex !== msg.account.deskIndex) patch.order = sortOrder(accounts);
        break;
      }
      case 'account_removed': {
        const { [msg.id]: _gone, ...rest } = s.accounts;
        patch.accounts = rest;
        patch.order = sortOrder(rest);
        if (s.selectedId === msg.id) patch.selectedId = null;
        break;
      }
      case 'rooms':
        patch.rooms = msg.rooms;
        break;
      case 'summary':
        patch.summary = msg.summary;
        break;
      case 'event': {
        // Mesmo id = atualização (ex.: evento do robô que ganhou correlação com execução real).
        const idx = s.events.findIndex((e) => e.id === msg.event.id);
        const events = idx >= 0 ? s.events.map((e, i) => (i === idx ? msg.event : e)) : [msg.event, ...s.events].slice(0, MAX_EVENTS);
        patch.events = events;
        break;
      }
    }
    set(patch);
    return 'ok';
  },
}));

/** Os dados estão chegando do servidor agora? Se não, toda a sala deve ser tratada como desatualizada. */
export function isServerLive(s: Pick<FloorState, 'ws' | 'lastMessageAt'>, now = Date.now()) {
  return s.ws === 'open' && now - s.lastMessageAt < 12_000;
}
