import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useFloor } from '../lib/store';
import { computeLayout } from './layout';
import { CameraRig } from './CameraRig';
import { DeskInstances, DeskUnit, TextureSchedulerRunner } from './Desks';
import { FpsProbe } from './FpsProbe';
import { Lights, RoomShell, WallScreen, ZoneSigns } from './Room';

export function FloorScene() {
  const quality = useFloor((s) => s.quality);
  const roomFilter = useFloor((s) => s.roomFilter);
  const rooms = useFloor((s) => s.rooms);
  // Só refaz o layout quando muda a organização (sala/ordem), nunca quando mudam valores.
  const layoutKey = useFloor(useShallow((s) => s.order.map((id) => `${id}@${s.accounts[id]?.roomId}#${s.accounts[id]?.deskIndex}`)));
  const layout = useMemo(() => {
    const accounts = useFloor.getState().accounts;
    return computeLayout(Object.values(accounts), rooms, roomFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey.join(','), rooms, roomFilter]);

  const dpr: [number, number] = quality === 'low' ? [0.75, 1] : quality === 'medium' ? [1, 1.5] : [1, 2];
  const panelRes = quality === 'low' ? 0.6 : quality === 'medium' ? 1 : 1.4;

  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={dpr}
      gl={{ antialias: quality !== 'low', powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [0, 14, 30], fov: 48, near: 0.1, far: 400 }}
      onPointerMissed={() => useFloor.getState().hoveredId && useFloor.getState().hover(null)}
    >
      <color attach="background" args={['#04060a']} />
      <fog attach="fog" args={['#04060a', 40, 140]} />
      <PerformanceMonitor />
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <Lights quality={quality} layout={layout} />
        <RoomShell layout={layout} quality={quality} />
        <WallScreen layout={layout} quality={quality} />
        <ZoneSigns layout={layout} />
        <DeskInstances slots={layout.desks} shadows={quality === 'high'} />
        {layout.desks.map((d) => (
          <DeskUnit key={d.id} slot={d} panelRes={panelRes} />
        ))}
        <TextureSchedulerRunner />
        <FpsProbe />
        <CameraRig layout={layout} />
        {quality === 'high' && (
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} />
            <Vignette eskil={false} offset={0.25} darkness={0.6} />
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
  );
}
