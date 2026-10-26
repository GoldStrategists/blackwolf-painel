import * as THREE from 'three';
import type { AccountView, ActivityEvent, DeskStatus, Summary } from '@bw/shared';
import { STATUS_COLOR, STATUS_LABEL, pnlColor } from '../lib/colors';
import { ago, compactMoney, money, NA } from '../lib/format';

/**
 * Painéis desenhados em <canvas> e usados como textura. Redesenhados só quando os dados
 * mudam — nunca a cada frame — e a cena 3D não é reconstruída.
 */

export function makeCanvasTexture(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, ctx: canvas.getContext('2d')!, tex };
}

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
const MONO = '"JetBrains Mono", Consolas, ui-monospace, monospace';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function effectiveStatus(a: AccountView, serverLive: boolean): DeskStatus {
  return serverLive ? a.status : 'stale';
}

/** Painel flutuante acima da mesa. */
export function drawDeskPanel(
  ctx: CanvasRenderingContext2D,
  a: AccountView,
  opts: { serverLive: boolean; selected: boolean; demo: boolean; now: number },
) {
  const { width: W, height: H } = ctx.canvas;
  const s = W / 512;
  const status = effectiveStatus(a, opts.serverLive);
  const color = STATUS_COLOR[status];
  const grey = status === 'offline' || status === 'stale' || status === 'nodata';
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 512, 320);

  // Fundo vidro escuro
  roundRect(ctx, 4, 4, 504, 312, 22);
  const g = ctx.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, 'rgba(14,20,31,0.94)');
  g.addColorStop(1, 'rgba(6,9,15,0.94)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = opts.selected ? 6 : 3;
  ctx.strokeStyle = opts.selected ? '#ffffff' : color;
  ctx.stroke();

  // Faixa de status
  roundRect(ctx, 4, 4, 504, 46, 22);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(4, 4, 504, 46);
  ctx.restore();

  ctx.fillStyle = '#e8eef8';
  ctx.font = `700 26px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, a.displayName, 300), 22, 28);
  ctx.textAlign = 'right';
  ctx.font = `800 17px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(STATUS_LABEL[status], 490, 28);
  ctx.textAlign = 'left';

  // Plataforma / conexão
  ctx.font = `500 16px ${FONT}`;
  ctx.fillStyle = '#8b99b2';
  const conn = [a.platform, a.provider, a.connectionName && a.connectionName !== a.provider ? a.connectionName : null].filter(Boolean).join(' · ');
  ctx.fillText(fit(ctx, conn || 'Plataforma não informada', opts.demo ? 250 : 330), 22, 68);
  const dot = a.connStatus === 'connected' && a.fresh && opts.serverLive ? '#1fd67a' : a.connStatus === 'connected' ? '#ffc533' : '#ff4053';
  const cx0 = opts.demo ? 290 : 372;
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(cx0, 68, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b99b2';
  ctx.fillText(a.connStatus === 'connected' ? (a.fresh && opts.serverLive ? 'ao vivo' : 'atrasada') : 'offline', cx0 + 12, 68);

  // Grade de valores
  const cells: [string, string, string][] = [
    ['SALDO', money(a.balance), '#e8eef8'],
    ['P&L DIA', money(a.totalToday, { sign: true }), pnlColor(a.totalToday)],
    ['ACUMULADO', money(a.cumulativePnl, { sign: true }), pnlColor(a.cumulativePnl)],
    ['POSIÇÕES', a.positions.length ? `${a.positions.length} · ${a.contracts} ctr` : 'nenhuma', '#e8eef8'],
    ['DD DISPONÍVEL', a.risk.drawdownRemaining != null ? money(a.risk.drawdownRemaining) : NA, a.risk.level === 'breach' ? '#ff4053' : a.risk.level === 'warn' ? '#ffc533' : '#e8eef8'],
    ['NÃO REALIZ.', money(a.unrealized, { sign: true }), pnlColor(a.unrealized)],
  ];
  cells.forEach(([label, value, c], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 22 + col * 248;
    const y = 104 + row * 62;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = '#6b7a93';
    ctx.fillText(label, x, y);
    ctx.font = `700 25px ${MONO}`;
    ctx.fillStyle = grey ? '#7d8799' : c;
    ctx.fillText(fit(ctx, value, 228), x, y + 27);
  });

  // Rodapé: aviso de dados velhos ou barra de risco
  if (grey) {
    ctx.fillStyle = 'rgba(255,197,51,0.14)';
    ctx.fillRect(4, 282, 504, 30);
    ctx.fillStyle = '#ffc533';
    ctx.font = `700 15px ${FONT}`;
    const msg =
      status === 'nodata'
        ? 'SEM DADOS DA PLATAFORMA'
        : `DADOS DESATUALIZADOS · ÚLTIMO VALOR HÁ ${ago(a.lastUpdateAt, opts.now)}`;
    ctx.fillText(msg, 22, 298);
  } else if (a.risk.drawdownUsedPct != null) {
    const used = a.risk.drawdownUsedPct;
    ctx.fillStyle = '#1a2230';
    roundRect(ctx, 22, 288, 468, 12, 6);
    ctx.fill();
    ctx.fillStyle = used >= 1 ? '#ff4053' : a.risk.level === 'warn' ? '#ffc533' : '#2f7bff';
    roundRect(ctx, 22, 288, Math.max(12, 468 * Math.min(1, used)), 12, 6);
    ctx.fill();
  } else {
    ctx.fillStyle = '#56627a';
    ctx.font = `500 14px ${FONT}`;
    ctx.fillText(a.risk.ruleType === 'none' ? 'Regras de risco não configuradas' : 'Drawdown não calculável', 22, 296);
  }

  if (opts.demo) {
    ctx.save();
    ctx.font = `900 15px ${FONT}`;
    ctx.fillStyle = '#ffc533';
    ctx.textAlign = 'right';
    ctx.fillText('DEMO', 490, 68);
    ctx.restore();
  }
}

/** Telas dos monitores: 3 monitores lado a lado numa única textura (UVs divididos). */
export function drawDeskScreens(ctx: CanvasRenderingContext2D, a: AccountView, serverLive: boolean, demo: boolean) {
  const { width: W, height: H } = ctx.canvas;
  const w = W / 3;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#03060b';
  ctx.fillRect(0, 0, W, H);
  const live = serverLive && a.fresh;
  const dim = live ? 1 : 0.35;
  ctx.globalAlpha = dim;

  // Monitor 1: posições abertas
  ctx.font = `700 ${H * 0.09}px ${FONT}`;
  ctx.fillStyle = '#4f9bff';
  ctx.fillText('POSIÇÕES', w * 0.06, H * 0.14);
  ctx.font = `500 ${H * 0.075}px ${MONO}`;
  if (a.positions.length === 0) {
    ctx.fillStyle = '#56627a';
    ctx.fillText('sem posição aberta', w * 0.06, H * 0.32);
  }
  a.positions.slice(0, 5).forEach((p, i) => {
    const y = H * (0.3 + i * 0.13);
    ctx.fillStyle = p.side === 'long' ? '#1fd67a' : '#ff4053';
    ctx.fillText(`${p.side === 'long' ? 'L' : 'S'}${p.quantity} ${p.instrument}`, w * 0.06, y);
    ctx.fillStyle = pnlColor(p.unrealized);
    ctx.textAlign = 'right';
    ctx.fillText(p.unrealized == null ? NA : compactMoney(p.unrealized), w * 0.95, y);
    ctx.textAlign = 'left';
  });

  // Monitor 2: curva de equity real (pontos vindos do servidor)
  const x0 = w + w * 0.05;
  const cw = w * 0.9;
  ctx.font = `700 ${H * 0.09}px ${FONT}`;
  ctx.fillStyle = '#4f9bff';
  ctx.fillText('EQUITY', x0, H * 0.14);
  ctx.textAlign = 'right';
  ctx.fillStyle = pnlColor(a.totalToday);
  ctx.fillText(money(a.equity, { compact: true }), w * 2 - w * 0.05, H * 0.14);
  ctx.textAlign = 'left';
  const pts = a.sparkline;
  ctx.strokeStyle = '#1c2534';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x0, H * (0.22 + i * 0.18));
    ctx.lineTo(x0 + cw, H * (0.22 + i * 0.18));
    ctx.stroke();
  }
  if (pts.length >= 2) {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const ys = (v: number) => H * 0.92 - ((v - min) / span) * H * 0.66;
    const grad = ctx.createLinearGradient(0, H * 0.25, 0, H * 0.95);
    const up = pts[pts.length - 1]! >= pts[0]!;
    grad.addColorStop(0, up ? 'rgba(31,214,122,0.45)' : 'rgba(255,64,83,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = x0 + (i / (pts.length - 1)) * cw;
      if (i === 0) ctx.moveTo(x, ys(v));
      else ctx.lineTo(x, ys(v));
    });
    ctx.lineWidth = H * 0.018;
    ctx.strokeStyle = up ? '#1fd67a' : '#ff4053';
    ctx.stroke();
    ctx.lineTo(x0 + cw, H * 0.95);
    ctx.lineTo(x0, H * 0.95);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    ctx.fillStyle = '#56627a';
    ctx.font = `500 ${H * 0.075}px ${FONT}`;
    ctx.fillText('aguardando histórico…', x0, H * 0.55);
  }

  // Monitor 3: risco
  const x2 = w * 2 + w * 0.06;
  ctx.font = `700 ${H * 0.09}px ${FONT}`;
  ctx.fillStyle = '#4f9bff';
  ctx.fillText('RISCO', x2, H * 0.14);
  const r = a.risk;
  const lines: [string, string, string][] = [
    ['Limite', money(r.liquidationThreshold, { compact: true }), '#c7d1e0'],
    ['Disponível', money(r.drawdownRemaining, { compact: true }), r.level === 'warn' ? '#ffc533' : r.level === 'breach' ? '#ff4053' : '#1fd67a'],
    ['Diário', r.dailyLossRemaining != null ? money(r.dailyLossRemaining, { compact: true }) : NA, '#c7d1e0'],
    ['Ordens', String(a.orders.length), '#c7d1e0'],
  ];
  lines.forEach(([k, v, c], i) => {
    const y = H * (0.32 + i * 0.16);
    ctx.font = `500 ${H * 0.07}px ${FONT}`;
    ctx.fillStyle = '#6b7a93';
    ctx.fillText(k, x2, y);
    ctx.font = `700 ${H * 0.08}px ${MONO}`;
    ctx.fillStyle = c;
    ctx.textAlign = 'right';
    ctx.fillText(v, w * 3 - w * 0.06, y);
    ctx.textAlign = 'left';
  });

  ctx.globalAlpha = 1;
  if (!live) {
    ctx.fillStyle = 'rgba(255,197,51,0.9)';
    ctx.font = `800 ${H * 0.1}px ${FONT}`;
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) ctx.fillText(a.connStatus === 'connected' ? 'DESATUALIZADO' : 'OFFLINE', w * i + w / 2, H * 0.6);
    ctx.textAlign = 'left';
  }
  if (demo) {
    ctx.fillStyle = 'rgba(255,197,51,0.85)';
    ctx.font = `800 ${H * 0.06}px ${FONT}`;
    for (let i = 0; i < 3; i++) ctx.fillText('DEMO', w * i + w * 0.78, H * 0.96);
  }
}

/** Telão principal com métricas consolidadas. */
export function drawWallScreen(ctx: CanvasRenderingContext2D, s: Summary | null, accounts: AccountView[], opts: { demo: boolean; serverLive: boolean }) {
  const { width: W, height: H } = ctx.canvas;
  const k = W / 2048;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, 800);
  g.addColorStop(0, '#060a12');
  g.addColorStop(1, '#03050a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 800);
  ctx.strokeStyle = 'rgba(47,123,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 2048; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 800);
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2f7bff';
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText('BLACK WOLF', 60, 92);
  const tw = ctx.measureText('BLACK WOLF').width;
  ctx.fillStyle = '#c7d1e0';
  ctx.font = `300 54px ${FONT}`;
  ctx.fillText('TRADING FLOOR', 60 + tw + 24, 92);
  ctx.textAlign = 'right';
  ctx.font = `800 34px ${FONT}`;
  ctx.fillStyle = opts.demo ? '#ffc533' : '#ff4053';
  ctx.fillText(opts.demo ? '● MODO DEMO · DADOS FICTÍCIOS' : '● AO VIVO', 1988, 88);
  ctx.textAlign = 'left';

  if (!s) {
    ctx.fillStyle = '#6b7a93';
    ctx.font = `500 40px ${FONT}`;
    ctx.fillText('Aguardando dados…', 60, 300);
    return;
  }

  const tiles: [string, string, string, string?][] = [
    ['P&L TOTAL HOJE', money(s.totalToday, { sign: true }), pnlColor(s.totalToday), 'realizado + não realizado'],
    ['REALIZADO HOJE', money(s.realizedToday, { sign: true }), pnlColor(s.realizedToday)],
    ['NÃO REALIZADO', money(s.unrealized, { sign: true }), pnlColor(s.unrealized)],
    ['ACUMULADO', money(s.cumulativePnl, { sign: true }), pnlColor(s.cumulativePnl), 'saldo − saldo inicial'],
    ['CAPITAL NOMINAL', compactMoney(s.nominalCapital), '#c7d1e0', 'NÃO é patrimônio nem sacável'],
    ['SALDO SOMADO', compactMoney(s.balanceTotal), '#c7d1e0', 'saldo das contas atualizadas'],
    ['CONECTADAS', `${s.accountsConnected}/${s.accountsTotal}`, s.accountsConnected === s.accountsTotal ? '#1fd67a' : '#ffc533'],
    ['POSITIVAS / NEGATIVAS', `${s.accountsPositive} / ${s.accountsNegative}`, '#c7d1e0'],
    ['POSIÇÕES ABERTAS', `${s.openPositions} · ${s.openContracts} ctr`, '#c7d1e0'],
    ['RISCO', `${s.riskBreach} limite · ${s.riskWarn} alerta`, s.riskBreach ? '#ff4053' : s.riskWarn ? '#ffc533' : '#1fd67a', s.minDrawdownRemaining != null ? `menor DD: ${money(s.minDrawdownRemaining, { compact: true })}` : undefined],
  ];
  tiles.forEach(([label, value, color, sub], i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = 60 + col * 392;
    const y = 140 + row * 170;
    ctx.fillStyle = 'rgba(20,28,42,0.85)';
    roundRect(ctx, x, y, 372, 150, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(79,155,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#7d8ba3';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(label, x + 22, y + 40);
    ctx.fillStyle = opts.serverLive ? color : '#6b7a93';
    ctx.font = `800 44px ${MONO}`;
    ctx.fillText(fit(ctx, value, 330), x + 22, y + 98);
    if (sub) {
      ctx.fillStyle = label === 'CAPITAL NOMINAL' ? '#ffc533' : '#56627a';
      ctx.font = `600 19px ${FONT}`;
      ctx.fillText(sub, x + 22, y + 132);
    }
  });

  // Barras de P&L por conta
  const fresh = accounts.filter((a) => a.fresh);
  const by = [...accounts].sort((a, b) => (b.totalToday ?? -Infinity) - (a.totalToday ?? -Infinity));
  const maxAbs = Math.max(1, ...fresh.map((a) => Math.abs(a.totalToday ?? 0)));
  const top = 500;
  const baseY = top + 130;
  ctx.fillStyle = '#7d8ba3';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('P&L DO DIA POR CONTA', 60, top);
  ctx.strokeStyle = '#2a3548';
  ctx.beginPath();
  ctx.moveTo(60, baseY);
  ctx.lineTo(1988, baseY);
  ctx.stroke();
  const n = Math.max(1, by.length);
  const bw = Math.min(70, 1928 / n - 6);
  by.forEach((a, i) => {
    const x = 60 + i * (1928 / n) + (1928 / n - bw) / 2;
    const v = a.totalToday ?? 0;
    const h = (Math.abs(v) / maxAbs) * 110;
    ctx.fillStyle = !a.fresh || !opts.serverLive ? '#3c4a62' : STATUS_COLOR[a.status === 'risk' || a.status === 'breach' ? a.status : v >= 0 ? 'profit' : 'loss'];
    ctx.fillRect(x, v >= 0 ? baseY - h : baseY, bw, Math.max(2, h));
  });

  ctx.fillStyle = '#56627a';
  ctx.font = `500 20px ${FONT}`;
  const excluded = s.accountsExcludedStale ? ` · ${s.accountsExcludedStale} conta(s) fora dos totais por dados desatualizados/offline` : '';
  ctx.fillText(`Totais calculados só com contas atualizadas${excluded}. Capital nominal = soma dos tamanhos das contas.`, 60, 784);
  if (!opts.serverLive) {
    ctx.fillStyle = 'rgba(3,5,10,0.7)';
    ctx.fillRect(0, 0, 2048, 800);
    ctx.fillStyle = '#ffc533';
    ctx.textAlign = 'center';
    ctx.font = `900 70px ${FONT}`;
    ctx.fillText('SEM CONEXÃO COM O SERVIDOR', 1024, 380);
    ctx.font = `600 36px ${FONT}`;
    ctx.fillText('valores congelados — não use para decisões', 1024, 440);
    ctx.textAlign = 'left';
  }
}

/** Letreiro de eventos (desliza via offset da textura). */
export function drawTicker(ctx: CanvasRenderingContext2D, events: ActivityEvent[], demo: boolean) {
  const { width: W, height: H } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#020409';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `700 ${H * 0.5}px ${FONT}`;
  ctx.textBaseline = 'middle';
  let x = 20;
  const list = events.slice(0, 14);
  if (list.length === 0) {
    ctx.fillStyle = '#56627a';
    ctx.fillText(demo ? 'DEMO · aguardando eventos' : 'Aguardando eventos', x, H / 2);
    return;
  }
  for (const e of list) {
    const tag = e.kind === 'robot' ? (e.correlatedExecutionId ? 'ROBÔ ✓' : 'ROBÔ') : e.kind === 'execution' ? 'EXECUÇÃO' : e.kind === 'alert' ? 'ALERTA' : 'SISTEMA';
    const color = e.severity === 'error' ? '#ff4053' : e.severity === 'warning' ? '#ffc533' : e.kind === 'execution' ? '#1fd67a' : '#4f9bff';
    ctx.fillStyle = color;
    ctx.fillText(`■ ${tag}`, x, H / 2);
    x += ctx.measureText(`■ ${tag}`).width + 14;
    ctx.fillStyle = '#c7d1e0';
    const t = (e.accountId ? `${e.accountId.split(':').slice(1).join(':')} · ` : '') + e.message;
    ctx.fillText(t, x, H / 2);
    x += ctx.measureText(t).width + 60;
    if (x > W) break;
  }
}

/** Placas com o nome dos setores e o logo. */
export function drawSign(ctx: CanvasRenderingContext2D, title: string, sub: string) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(5,8,14,0.85)';
  roundRect(ctx, 2, 2, W - 4, H - 4, H * 0.18);
  ctx.fill();
  ctx.strokeStyle = '#2f7bff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#e8eef8';
  ctx.font = `800 ${H * 0.36}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(fit(ctx, title, W - 40), W / 2, H * 0.42);
  ctx.fillStyle = '#6b7a93';
  ctx.font = `600 ${H * 0.2}px ${FONT}`;
  ctx.fillText(sub, W / 2, H * 0.78);
  ctx.textAlign = 'left';
}

export function drawLogo(ctx: CanvasRenderingContext2D) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `900 ${H * 0.5}px ${FONT}`;
  ctx.fillStyle = '#2f7bff';
  ctx.fillText('BLACK WOLF', W / 2, H * 0.4);
  ctx.font = `400 ${H * 0.2}px ${FONT}`;
  ctx.fillStyle = '#9aa8bf';
  ctx.fillText('T R A D I N G   F L O O R', W / 2, H * 0.82);
  ctx.textAlign = 'left';
}
