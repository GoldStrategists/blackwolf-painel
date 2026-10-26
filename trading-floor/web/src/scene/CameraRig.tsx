import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import type CameraControlsImpl from 'camera-controls';
import { useFloor } from '../lib/store';
import type { FloorLayout } from './layout';

/**
 * Câmera com transições suaves: panorâmica, superior, livre (mouse + WASD/QE) e foco
 * em mesa. Usa camera-controls (amortecimento e limites embutidos).
 */
export function CameraRig({ layout }: { layout: FloorLayout }) {
  const ref = useRef<CameraControlsImpl>(null);
  const camera = useFloor((s) => s.camera);
  const nonce = useFloor((s) => s.cameraNonce);
  const selectedId = useFloor((s) => s.selectedId);
  const keys = useRef(new Set<string>());

  const { bounds, wallZ } = layout;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const width = bounds.maxX - bounds.minX;
  const cz = (wallZ + bounds.maxZ) / 2;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const desk = selectedId ? layout.desks.find((d) => d.id === selectedId) : null;
    if (camera === 'focus' && desk) {
      void c.setLookAt(desk.x + 0.8, 4.4, desk.z + 7.8, desk.x, 2.2, desk.z - 0.6, true);
    } else if (camera === 'top') {
      const h = Math.max(26, width * 0.95, (bounds.maxZ - wallZ) * 1.2);
      void c.setLookAt(cx, h, cz + 0.01, cx, 0, cz, true);
    } else if (camera === 'panorama' || (camera === 'focus' && !desk)) {
      // Enquadra a largura total da sala (FOV horizontal ~77° em 16:9) com folga para os painéis laterais.
      const aspect = Math.max(0.6, window.innerWidth / Math.max(1, window.innerHeight));
      const dist = Math.max(18, (width * 0.55) / Math.tan(Math.atan(Math.tan((24 * Math.PI) / 180) * aspect)));
      void c.setLookAt(cx, 8 + dist * 0.32, bounds.maxZ + dist * 0.62, cx, 3, cz - 3, true);
    }
    // 'free': mantém a posição atual e libera o controle total ao usuário.
  }, [camera, nonce, selectedId, layout, cx, cz, width, bounds.maxZ, wallZ]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      keys.current.add(e.key.toLowerCase());
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase()) && useFloor.getState().camera !== 'free') useFloor.getState().setCamera('free');
      if (e.key === 'Escape') useFloor.getState().select(null);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c || keys.current.size === 0) return;
    const k = keys.current;
    const speed = (k.has('shift') ? 18 : 8) * dt;
    if (k.has('w')) void c.forward(speed, false);
    if (k.has('s')) void c.forward(-speed, false);
    if (k.has('a')) void c.truck(-speed, 0, false);
    if (k.has('d')) void c.truck(speed, 0, false);
    if (k.has('q')) void c.elevate(-speed, false);
    if (k.has('e')) void c.elevate(speed, false);
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={2}
      maxDistance={120}
      maxPolarAngle={Math.PI / 2 - 0.04}
      smoothTime={0.45}
      draggingSmoothTime={0.12}
      dollyToCursor
      onStart={() => {
        const s = useFloor.getState();
        if (s.camera !== 'free' && s.camera !== 'focus') s.setCamera('free');
      }}
    />
  );
}
