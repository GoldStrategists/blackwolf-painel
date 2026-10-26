import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useFloor, isServerLive } from '../lib/store';
import type { FloorLayout } from './layout';
import { drawLogo, drawSign, drawTicker, drawWallScreen, makeCanvasTexture } from './textures';
import type { Quality } from '../lib/store';

export const CEILING = 13;

/** Casca da sala: piso, paredes, teto com luminárias, colunas e identidade visual. */
export function RoomShell({ layout, quality }: { layout: FloorLayout; quality: Quality }) {
  const { bounds, wallZ } = layout;
  const width = Math.max(44, bounds.maxX - bounds.minX + 18);
  const depth = Math.max(36, bounds.maxZ - wallZ + 16);
  const cz = wallZ + depth / 2 - 1;
  const ceil = CEILING;

  const ceilingRef = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (ceilingRef.current) ceilingRef.current.visible = camera.position.y < ceil - 0.3;
  });

  const stripes = useMemo(() => {
    const out: { x: number; z: number; len: number }[] = [];
    for (let x = -width / 2 + 5; x <= width / 2 - 5; x += 7) out.push({ x, z: cz, len: depth - 6 });
    return out;
  }, [width, depth, cz]);

  return (
    <group>
      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, cz]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        {quality === 'high' ? (
          <MeshReflectorMaterial
            resolution={512}
            blur={[300, 80]}
            mixBlur={0.9}
            mixStrength={1.2}
            roughness={0.85}
            depthScale={0.6}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.2}
            color="#0a0d13"
            metalness={0.6}
            mirror={0}
          />
        ) : (
          <meshStandardMaterial color="#0a0d13" roughness={0.55} metalness={0.5} />
        )}
      </mesh>
      <FloorGrid width={width} depth={depth} cz={cz} />

      {/* Teto: some quando a câmera sobe acima dele (vista "maquete") */}
      <group ref={ceilingRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ceil, cz]}>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial color="#07090d" roughness={0.9} />
        </mesh>
        {stripes.map((s, i) => (
          <mesh key={i} position={[s.x, ceil - 0.05, s.z]}>
            <boxGeometry args={[0.22, 0.05, s.len]} />
            <meshBasicMaterial color="#9cc2ff" toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* Parede do fundo (telão) */}
      <mesh position={[0, ceil / 2, wallZ - 0.3]}>
        <boxGeometry args={[width, ceil, 0.4]} />
        <meshStandardMaterial color="#0b0f16" roughness={0.7} metalness={0.3} />
      </mesh>
      {/* Paredes laterais com painéis de vidro escuro */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[(side * width) / 2, ceil / 2, cz]}>
            <boxGeometry args={[0.4, ceil, depth]} />
            <meshStandardMaterial color="#090c12" roughness={0.8} />
          </mesh>
          {Array.from({ length: Math.floor(depth / 6) }).map((_, i) => (
            <mesh key={i} position={[side * (width / 2 - 0.25), 5.2, wallZ + 4 + i * 6]} rotation={[0, -side * Math.PI / 2, 0]}>
              <planeGeometry args={[4.6, 7.4]} />
              <meshStandardMaterial color="#0d1d38" emissive="#0b2552" emissiveIntensity={0.35} roughness={0.2} metalness={0.8} />
            </mesh>
          ))}
          <mesh position={[side * (width / 2 - 0.22), 0.06, cz]}>
            <boxGeometry args={[0.05, 0.06, depth]} />
            <meshBasicMaterial color="#2f7bff" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <Logo position={[0, ceil - 1.3, wallZ - 0.05]} />
    </group>
  );
}

function FloorGrid({ width, depth, cz }: { width: number; depth: number; cz: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = -width / 2; x <= width / 2; x += 2) pts.push(x, 0.005, cz - depth / 2, x, 0.005, cz + depth / 2);
    for (let z = cz - depth / 2; z <= cz + depth / 2; z += 2) pts.push(-width / 2, 0.005, z, width / 2, 0.005, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [width, depth, cz]);
  return (
    <lineSegments geometry={geo} raycast={() => null}>
      <lineBasicMaterial color="#14305e" transparent opacity={0.35} />
    </lineSegments>
  );
}

function Logo({ position }: { position: [number, number, number] }) {
  const t = useMemo(() => {
    const c = makeCanvasTexture(1024, 192);
    drawLogo(c.ctx);
    c.tex.needsUpdate = true;
    return c;
  }, []);
  return (
    <mesh position={position}>
      <planeGeometry args={[9, 1.7]} />
      <meshBasicMaterial map={t.tex} transparent toneMapped={false} />
    </mesh>
  );
}

/** Telão central + letreiro de eventos. */
export function WallScreen({ layout, quality }: { layout: FloorLayout; quality: Quality }) {
  const summary = useFloor((s) => s.summary);
  const accounts = useFloor((s) => s.accounts);
  const events = useFloor((s) => s.events);
  const demo = useFloor((s) => s.mode === 'demo');
  const ws = useFloor((s) => s.ws);
  const res = quality === 'low' ? 0.5 : 1;
  const screen = useMemo(() => makeCanvasTexture(2048 * res, 800 * res), [res]);
  const ticker = useMemo(() => {
    const t = makeCanvasTexture(4096 * res, 64 * res);
    t.tex.wrapS = THREE.RepeatWrapping;
    return t;
  }, [res]);

  // O telão é grande (2048×800): redesenha no máximo 1×/s, mesmo com 100+ contas atualizando.
  const wallDirty = useRef(true);
  const wallLast = useRef(0);
  useEffect(() => {
    wallDirty.current = true;
  }, [summary, accounts, demo, ws, screen]);

  useEffect(() => {
    drawTicker(ticker.ctx, events, demo);
    ticker.tex.needsUpdate = true;
  }, [events, demo, ticker]);

  useEffect(() => () => {
    screen.tex.dispose();
    ticker.tex.dispose();
  }, [screen, ticker]);

  useFrame((_, dt) => {
    ticker.tex.offset.x = (ticker.tex.offset.x + dt * 0.02) % 1;
    const now = performance.now();
    if (wallDirty.current && now - wallLast.current >= 1000) {
      wallDirty.current = false;
      wallLast.current = now;
      const st = useFloor.getState();
      drawWallScreen(screen.ctx, st.summary, Object.values(st.accounts), { demo: st.mode === 'demo', serverLive: isServerLive(st) });
      screen.tex.needsUpdate = true;
    }
  });

  const z = layout.wallZ;
  const w = Math.min(27, Math.max(19, (layout.bounds.maxX - layout.bounds.minX) * 0.5));
  const h = w * (800 / 2048);
  const y0 = 2.6;
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, y0 + h / 2, 0.02]}>
        <boxGeometry args={[w + 0.6, h + 0.6, 0.12]} />
        <meshStandardMaterial color="#020305" roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0, y0 + h / 2, 0.1]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={screen.tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, y0 - 0.75, 0.1]}>
        <planeGeometry args={[w + 0.6, (w + 0.6) / 64]} />
        <meshBasicMaterial map={ticker.tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, y0 - 0.35, 0.12]}>
        <boxGeometry args={[w + 0.6, 0.04, 0.04]} />
        <meshBasicMaterial color="#2f7bff" toneMapped={false} />
      </mesh>
      <pointLight position={[0, y0 + h / 2, 4]} intensity={22} distance={22} color="#3b7bff" />
    </group>
  );
}

/** Placas suspensas com o nome de cada sala/setor. */
export function ZoneSigns({ layout }: { layout: FloorLayout }) {
  return (
    <>
      {layout.zones.map((z) => (
        <ZoneSign key={z.room.id} title={z.room.name} sub={`${z.count} ${z.count === 1 ? 'mesa' : 'mesas'}`} x={(z.x0 + z.x1) / 2} z={z.z0 - 0.6} width={Math.min(z.x1 - z.x0, 9)} x0={z.x0} x1={z.x1} z0={z.z0} z1={z.z1} />
      ))}
    </>
  );
}

function ZoneSign(p: { title: string; sub: string; x: number; z: number; width: number; x0: number; x1: number; z0: number; z1: number }) {
  const t = useMemo(() => makeCanvasTexture(1024, 160), []);
  useEffect(() => {
    drawSign(t.ctx, p.title, p.sub);
    t.tex.needsUpdate = true;
  }, [p.title, p.sub, t]);
  const w = Math.max(4.5, p.width);
  const geo = useMemo(() => {
    const pad = 0.6;
    const x0 = p.x0 + pad;
    const x1 = p.x1 - pad;
    const z0 = p.z0;
    const z1 = p.z1;
    const pts = [x0, 0.02, z0, x1, 0.02, z0, x1, 0.02, z0, x1, 0.02, z1, x1, 0.02, z1, x0, 0.02, z1, x0, 0.02, z1, x0, 0.02, z0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [p.x0, p.x1, p.z0, p.z1]);
  return (
    <>
      <mesh position={[p.x, 4.3, p.z]}>
        <planeGeometry args={[w, w * (160 / 1024)]} />
        <meshBasicMaterial map={t.tex} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={geo} raycast={() => null}>
        <lineBasicMaterial color="#2f7bff" transparent opacity={0.6} />
      </lineSegments>
    </>
  );
}

/** Luzes: poucas e baratas; sombras só na qualidade alta. */
export function Lights({ quality, layout }: { quality: Quality; layout: FloorLayout }) {
  const dir = useRef<THREE.DirectionalLight>(null);
  const span = Math.max(30, layout.bounds.maxX - layout.bounds.minX + 10);
  useEffect(() => {
    const l = dir.current;
    if (!l) return;
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -span / 2;
    cam.right = span / 2;
    cam.top = span / 2;
    cam.bottom = -span / 2;
    cam.updateProjectionMatrix();
  }, [span]);
  return (
    <>
      <ambientLight intensity={0.35} color="#8fb0ff" />
      <hemisphereLight args={['#6d8fd6', '#05070b', 0.5]} />
      <directionalLight
        ref={dir}
        position={[8, 16, 10]}
        intensity={1.1}
        color="#dfe9ff"
        castShadow={quality === 'high'}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      />
      <spotLight position={[0, 8.5, layout.bounds.maxZ]} angle={0.9} penumbra={0.8} intensity={30} distance={40} color="#7aa7ff" />
    </>
  );
}
