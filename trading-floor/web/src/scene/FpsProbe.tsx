import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/** Mede FPS e publica num elemento do HUD (sem re-render do React). */
export function FpsProbe() {
  const acc = useRef({ frames: 0, t0: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t0 >= 1000) {
      const fps = Math.round((a.frames * 1000) / (now - a.t0));
      a.frames = 0;
      a.t0 = now;
      const el = document.getElementById('bw-fps');
      if (el) el.textContent = `${fps} fps`;
    }
  });
  return null;
}
