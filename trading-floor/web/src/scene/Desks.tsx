import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useFloor, isServerLive } from '../lib/store';
import { STATUS_COLOR } from '../lib/colors';
import type { DeskSlot } from './layout';
import { drawDeskPanel, drawDeskScreens, effectiveStatus, makeCanvasTexture } from './textures';
import { markDirty, registerDesk, runScheduler } from './textureScheduler';

// ---------------------------------------------------------------------------
// Geometria compartilhada (criada uma vez para todas as mesas)
// ---------------------------------------------------------------------------
const MON_W = 0.95;
const MON_H = 0.56;
const MONITORS = [
  { x: -1.0, rot: 0.32 },
  { x: 0, rot: 0 },
  { x: 1.0, rot: -0.32 },
];

function screenGeometry(i: number) {
  const g = new THREE.PlaneGeometry(MON_W - 0.05, MON_H - 0.05);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
  uv.needsUpdate = true;
  return g;
}
// Os 3 monitores de uma mesa numa única geometria (1 draw call), cada um com 1/3 da textura.
const SCREENS_GEO = mergeGeometries(
  MONITORS.map((m, i) =>
    screenGeometry(i)
      .rotateY(m.rot)
      .translate(m.x + Math.sin(m.rot) * 0.025, 1.22, -0.42 + Math.abs(m.rot) * 0.5 + 0.022),
  ),
)!;
const PANEL_GEO = new THREE.PlaneGeometry(2.6, 1.625);
const HIT_GEO = new THREE.BoxGeometry(3.6, 2.2, 2.6);
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Transformações locais (uma ou mais por mesa). */
  locals: THREE.Matrix4[];
  colored?: boolean;
  castShadow?: boolean;
}

const m4 = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

function useParts(): Part[] {
  return useMemo(() => {
    const deskTop = new THREE.MeshStandardMaterial({ color: '#1a2130', roughness: 0.35, metalness: 0.6 });
    const deskBody = new THREE.MeshStandardMaterial({ color: '#0d1118', roughness: 0.6, metalness: 0.4 });
    const bezel = new THREE.MeshStandardMaterial({ color: '#07090d', roughness: 0.4, metalness: 0.7 });
    const chairMat = new THREE.MeshStandardMaterial({ color: '#141922', roughness: 0.8, metalness: 0.2 });
    const led = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const glow = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, alphaMap: radialTexture(), opacity: 0.26, toneMapped: false });
    return [
      { geo: new THREE.BoxGeometry(3.4, 0.07, 1.5), mat: deskTop, locals: [m4(0, 0.76, 0)], castShadow: true },
      { geo: new THREE.BoxGeometry(0.07, 0.74, 1.4), mat: deskBody, locals: [m4(-1.62, 0.37, 0), m4(1.62, 0.37, 0)] },
      { geo: new THREE.BoxGeometry(3.2, 0.5, 0.05), mat: deskBody, locals: [m4(0, 0.48, -0.66)] },
      { geo: new THREE.BoxGeometry(MON_W, MON_H, 0.04), mat: bezel, locals: MONITORS.map((m) => m4(m.x, 1.22, -0.42 + Math.abs(m.rot) * 0.5, m.rot)), castShadow: true },
      { geo: new THREE.BoxGeometry(0.05, 0.4, 0.05), mat: bezel, locals: MONITORS.map((m) => m4(m.x, 0.98, -0.45 + Math.abs(m.rot) * 0.5)) },
      { geo: new THREE.BoxGeometry(0.62, 0.09, 0.58), mat: chairMat, locals: [m4(0, 0.52, 1.25)] },
      { geo: new THREE.BoxGeometry(0.62, 0.78, 0.08), mat: chairMat, locals: [m4(0, 0.98, 1.56, 0)] },
      { geo: new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), mat: bezel, locals: [m4(0, 0.27, 1.25)] },
      { geo: new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), mat: bezel, locals: [m4(0, 0.04, 1.25)] },
      // Faixa de LED na borda frontal da mesa e luz no piso: ambas assumem a cor do status.
      { geo: new THREE.BoxGeometry(3.3, 0.035, 0.035), mat: led, locals: [m4(0, 0.73, 0.76)], colored: true },
      { geo: new THREE.BoxGeometry(0.035, 0.035, 1.4), mat: led, locals: [m4(-1.69, 0.73, 0), m4(1.69, 0.73, 0)], colored: true },
      { geo: new THREE.PlaneGeometry(4.6, 3.2).rotateX(-Math.PI / 2), mat: glow, locals: [m4(0, 0.012, 0.3)], colored: true },
    ];
  }, []);
}

const tmp = new THREE.Matrix4();
const base = new THREE.Matrix4();
const col = new THREE.Color();

/** Todas as partes estáticas das mesas via InstancedMesh: poucas draw calls para 20..200 mesas. */
export function DeskInstances({ slots, shadows }: { slots: DeskSlot[]; shadows: boolean }) {
  const parts = useParts();
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const statuses = useFloor((s) => slots.map((d) => s.accounts[d.id]?.status ?? 'nodata').join('|'));
  const ws = useFloor((s) => s.ws);

  useLayoutEffect(() => {
    parts.forEach((p, pi) => {
      const mesh = refs.current[pi];
      if (!mesh) return;
      let k = 0;
      for (const d of slots) {
        base.makeTranslation(d.x, 0, d.z);
        for (const l of p.locals) mesh.setMatrixAt(k++, tmp.multiplyMatrices(base, l));
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [slots, parts]);

  // Cores do status (sem recriar nada da cena).
  useEffect(() => {
    const st = isServerLive(useFloor.getState()) ? statuses.split('|') : slots.map(() => 'stale');
    parts.forEach((p, pi) => {
      const mesh = refs.current[pi];
      if (!mesh || !p.colored) return;
      let k = 0;
      slots.forEach((_, i) => {
        col.set(STATUS_COLOR[(st[i] ?? 'nodata') as keyof typeof STATUS_COLOR]);
        for (let j = 0; j < p.locals.length; j++) mesh.setColorAt(k++, col);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [statuses, slots, parts, ws]);

  // Pulso discreto nas mesas com limite atingido.
  useFrame(({ clock }) => {
    if (!statuses.includes('breach')) return;
    const st = statuses.split('|');
    const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5));
    parts.forEach((p, pi) => {
      const mesh = refs.current[pi];
      if (!mesh || !p.colored) return;
      let k = 0;
      slots.forEach((_, i) => {
        const breach = st[i] === 'breach';
        if (breach) col.set(STATUS_COLOR.breach).multiplyScalar(pulse);
        for (let j = 0; j < p.locals.length; j++) {
          if (breach) mesh.setColorAt(k, col);
          k++;
        }
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  });

  const max = Math.max(1, slots.length);
  return (
    <group>
      {parts.map((p, i) => (
        <instancedMesh
          key={`${i}-${max}`}
          ref={(m) => {
            refs.current[i] = m;
            if (m && p.colored && !m.instanceColor) {
              m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * p.locals.length * 3).fill(0.4), 3);
            }
          }}
          args={[p.geo, p.mat, max * p.locals.length]}
          castShadow={shadows && !!p.castShadow}
          receiveShadow={false}
          frustumCulled={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}

/** Parte dinâmica de cada mesa: telas, painel flutuante e área clicável. */
export const DeskUnit = memo(function DeskUnit({ slot, panelRes }: { slot: DeskSlot; panelRes: number }) {
  const account = useFloor((s) => s.accounts[slot.id]);
  const selected = useFloor((s) => s.selectedId === slot.id);
  const hovered = useFloor((s) => s.hoveredId === slot.id);
  const demo = useFloor((s) => s.mode === 'demo');
  const ws = useFloor((s) => s.ws);
  const lastMessageAt = useFloor((s) => Math.floor(s.lastMessageAt / 5000));

  const panel = useMemo(() => makeCanvasTexture(512 * panelRes, 320 * panelRes), [panelRes]);
  const screens = useMemo(() => makeCanvasTexture(768 * panelRes, 160 * panelRes), [panelRes]);
  useEffect(
    () => () => {
      panel.tex.dispose();
      screens.tex.dispose();
    },
    [panel, screens],
  );

  // O desenho lê o estado mais recente na hora em que o agendador decide redesenhar.
  const position = useMemo(() => new THREE.Vector3(slot.x, 0, slot.z), [slot.x, slot.z]);
  useEffect(() => {
    let lastScreensKey = '';
    const draw = () => {
      const st = useFloor.getState();
      const a = st.accounts[slot.id];
      if (!a) return;
      const live = isServerLive(st);
      const isDemo = st.mode === 'demo';
      drawDeskPanel(panel.ctx, a, { serverLive: live, selected: st.selectedId === slot.id || st.hoveredId === slot.id, demo: isDemo, now: Date.now() });
      panel.tex.needsUpdate = true;
      // As telas não dependem de seleção nem do relógio: só reenvia se o conteúdo mudou.
      const key = `${a.equity}|${a.sparkline.length}|${a.sparkline[a.sparkline.length - 1]}|${JSON.stringify(a.positions)}|${JSON.stringify(a.risk)}|${a.orders.length}|${a.fresh}|${a.connStatus}|${live}|${isDemo}`;
      if (key !== lastScreensKey) {
        lastScreensKey = key;
        drawDeskScreens(screens.ctx, a, live, isDemo);
        screens.tex.needsUpdate = true;
      }
    };
    return registerDesk(slot.id, position, draw);
  }, [slot.id, position, panel, screens]);

  useEffect(() => markDirty(slot.id), [slot.id, account, demo, ws, lastMessageAt]);
  useEffect(() => markDirty(slot.id, true), [slot.id, selected, hovered]);

  const serverLive = isServerLive(useFloor.getState());
  const stale = !!account && (!account.fresh || !serverLive);
  // Contador "há Xs" só para mesas desatualizadas, sem re-renderizar o React.
  useEffect(() => {
    if (!stale) return;
    const t = window.setInterval(() => markDirty(slot.id), 1000);
    return () => window.clearInterval(t);
  }, [stale, slot.id]);

  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ map: screens.tex, toneMapped: false }), [screens]);
  const panelMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: panel.tex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
    [panel],
  );
  useEffect(
    () => () => {
      screenMat.dispose();
      panelMat.dispose();
    },
    [screenMat, panelMat],
  );

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useFloor.getState().hover(slot.id);
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    if (useFloor.getState().hoveredId === slot.id) useFloor.getState().hover(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useFloor.getState().select(slot.id);
  };

  const panelRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (panelRef.current) panelRef.current.position.y = 3.15 + Math.sin(clock.elapsedTime * 0.8 + slot.x) * 0.04 + (selected ? 0.15 : 0);
  });

  if (!account) return null;
  const status = effectiveStatus(account, serverLive);
  return (
    <group position={[slot.x, 0, slot.z]}>
      <mesh geometry={SCREENS_GEO} material={screenMat} raycast={() => null} />
      <group ref={panelRef} position={[0, 3.15, 0]}>
        <Billboard>
          <mesh geometry={PANEL_GEO} material={panelMat} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} scale={hovered || selected ? 1.06 : 1} />
        </Billboard>
      </group>
      <mesh geometry={HIT_GEO} material={HIT_MAT} position={[0, 1.1, 0.3]} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} />
      {(selected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.3]} raycast={() => null}>
          <ringGeometry args={[2.35, 2.5, 64]} />
          <meshBasicMaterial color={selected ? '#ffffff' : STATUS_COLOR[status]} toneMapped={false} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
});

/** Executa o agendador de texturas uma vez por frame. */
export function TextureSchedulerRunner() {
  useFrame(({ camera }) => runScheduler(camera, performance.now()));
  return null;
}
