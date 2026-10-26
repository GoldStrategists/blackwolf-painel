import type { AccountView, Room } from '@bw/shared';

export interface DeskSlot {
  id: string;
  x: number;
  z: number;
  roomId: string;
}

export interface ZoneInfo {
  room: Room;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  count: number;
}

export interface FloorLayout {
  desks: DeskSlot[];
  zones: ZoneInfo[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Posição do telão (parede do fundo). */
  wallZ: number;
}

export const DESK_SPACING_X = 4.4;
export const DESK_SPACING_Z = 5.2;
const ZONE_GAP = 5;
const FIRST_ROW_Z = -4;

/**
 * Distribui as mesas em fileiras por sala. Cada sala vira um setor lado a lado;
 * a ordem segue deskIndex. Funciona para 1..N contas (colunas crescem com √n).
 */
export function computeLayout(accounts: AccountView[], rooms: Room[], roomFilter: string): FloorLayout {
  const visibleRooms = rooms.filter((r) => roomFilter === 'all' || r.id === roomFilter);
  const byRoom = new Map<string, AccountView[]>();
  for (const r of visibleRooms) byRoom.set(r.id, []);
  for (const a of accounts) byRoom.get(a.roomId)?.push(a);

  // Contas em salas que não existem mais aparecem no primeiro setor (não somem).
  if (roomFilter === 'all' && visibleRooms[0]) {
    const known = new Set(visibleRooms.map((r) => r.id));
    for (const a of accounts) if (!known.has(a.roomId)) byRoom.get(visibleRooms[0].id)!.push(a);
  }

  const zonesRaw = visibleRooms
    .map((room) => {
      const list = (byRoom.get(room.id) ?? []).sort((a, b) => a.deskIndex - b.deskIndex || a.name.localeCompare(b.name));
      const cols = list.length <= 3 ? Math.max(1, list.length) : Math.min(6, Math.ceil(Math.sqrt(list.length * 1.4)));
      return { room, list, cols, width: Math.max(1, cols) * DESK_SPACING_X };
    })
    .filter((z) => z.list.length > 0 || roomFilter !== 'all');

  const totalWidth = zonesRaw.reduce((a, z) => a + z.width, 0) + ZONE_GAP * Math.max(0, zonesRaw.length - 1);
  let cursor = -totalWidth / 2;
  const desks: DeskSlot[] = [];
  const zones: ZoneInfo[] = [];
  let maxZ = FIRST_ROW_Z;

  for (const z of zonesRaw) {
    const x0 = cursor;
    z.list.forEach((a, i) => {
      const col = i % z.cols;
      const row = Math.floor(i / z.cols);
      const x = x0 + DESK_SPACING_X * (col + 0.5);
      const dz = FIRST_ROW_Z + row * DESK_SPACING_Z;
      desks.push({ id: a.id, x, z: dz, roomId: z.room.id });
      maxZ = Math.max(maxZ, dz);
    });
    const rows = Math.max(1, Math.ceil(z.list.length / z.cols));
    zones.push({ room: z.room, x0, x1: x0 + z.width, z0: FIRST_ROW_Z - 2.2, z1: FIRST_ROW_Z + (rows - 1) * DESK_SPACING_Z + 2.4, count: z.list.length });
    cursor += z.width + ZONE_GAP;
  }

  const half = Math.max(totalWidth / 2, 10);
  return {
    desks,
    zones,
    bounds: { minX: -half, maxX: half, minZ: FIRST_ROW_Z - 4, maxZ: maxZ + 3 },
    wallZ: FIRST_ROW_Z - 9,
  };
}
