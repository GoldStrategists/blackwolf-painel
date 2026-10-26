import * as THREE from 'three';

/**
 * Agendador de redesenho das texturas das mesas. Cada mesa marca "sujo" quando os dados
 * mudam; o redesenho (canvas → upload para a GPU) acontece aqui com orçamento por frame:
 *  - fora da tela: espera até voltar a ficar visível;
 *  - perto: imediato; média distância: ≤ 1×/s; longe: ≤ 1× a cada 3 s;
 *  - no máximo BUDGET uploads por frame, priorizando as mais próximas.
 * Assim 100+ mesas custam praticamente o mesmo que 20.
 */

interface Entry {
  dirty: boolean;
  urgent: boolean;
  lastDraw: number;
  position: THREE.Vector3;
  draw: () => void;
}

const entries = new Map<string, Entry>();
const BUDGET = 4;
const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();
const sphere = new THREE.Sphere(new THREE.Vector3(), 3.5);

export function registerDesk(id: string, position: THREE.Vector3, draw: () => void) {
  entries.set(id, { dirty: true, urgent: true, lastDraw: 0, position, draw });
  return () => {
    if (entries.get(id)?.draw === draw) entries.delete(id);
  };
}

export function markDirty(id: string, urgent = false) {
  const e = entries.get(id);
  if (!e) return;
  e.dirty = true;
  e.urgent = e.urgent || urgent;
}

export function runScheduler(camera: THREE.Camera, now: number) {
  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(matrix);
  const candidates: { e: Entry; d: number }[] = [];
  for (const e of entries.values()) {
    if (!e.dirty) continue;
    sphere.center.copy(e.position);
    sphere.center.y = 2;
    if (!frustum.intersectsSphere(sphere) && !e.urgent) continue;
    const d = camera.position.distanceTo(sphere.center);
    const interval = e.urgent || d < 18 ? 0 : d < 40 ? 1000 : 3000;
    if (now - e.lastDraw < interval) continue;
    candidates.push({ e, d: e.urgent ? -1 : d });
  }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => a.d - b.d);
  for (let i = 0; i < Math.min(BUDGET, candidates.length); i++) {
    const { e } = candidates[i]!;
    e.dirty = false;
    e.urgent = false;
    e.lastDraw = now;
    e.draw();
  }
}
