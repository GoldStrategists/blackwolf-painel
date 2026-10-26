import type { ConnStatus, DeskStatus } from '@bw/shared';

export const STATUS_COLOR: Record<DeskStatus, string> = {
  profit: '#1fd67a',
  loss: '#ff4053',
  risk: '#ffc533',
  breach: '#ff1f3d',
  flat: '#2f7bff',
  offline: '#5b6477',
  stale: '#5b6477',
  nodata: '#5b6477',
};

export const STATUS_LABEL: Record<DeskStatus, string> = {
  profit: 'LUCRO',
  loss: 'PREJUÍZO',
  risk: 'PERTO DO LIMITE',
  breach: 'LIMITE ATINGIDO',
  flat: 'ZERADA',
  offline: 'DESCONECTADA',
  stale: 'DESATUALIZADA',
  nodata: 'SEM DADOS',
};

export const CONN_LABEL: Record<ConnStatus, string> = {
  connected: 'Conectada',
  connecting: 'Conectando',
  connection_lost: 'Conexão perdida',
  disconnecting: 'Desconectando',
  disconnected: 'Desconectada',
  unknown: 'Desconhecida',
};

export const pnlColor = (v: number | null | undefined) => (v == null ? '#9aa8bf' : v > 0.005 ? '#1fd67a' : v < -0.005 ? '#ff4053' : '#c7d1e0');
export const pnlClass = (v: number | null | undefined) => (v == null ? 'text-wolf-300' : v > 0.005 ? 'text-pos' : v < -0.005 ? 'text-neg' : 'text-wolf-200');
