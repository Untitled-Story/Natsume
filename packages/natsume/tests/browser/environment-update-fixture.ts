import { createPlaybackHarness } from './playback-harness.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, constant } from '../particle-fixtures.js';
import { EffectPack } from '../../src/pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';

export async function verifyEnvironmentUpdates() {
  const { app, runtime } = await createPlaybackHarness();
  const document = minimalDocument(),
    source = particleSource();
  source.main!.gravityMultiplier = constant(1);
  document.components = [new ComponentT(3, 1, true, ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  try {
    const effect = await runtime.instantiate(pack, {
      particleEnvironment: { fog: { mode: 'none' }, gravity: [0, -4, 0], viewPosition: [0, 0, -5] },
      renderEnvironment: { globalMipBias: 1, sortingLayers: { 7: 2 } },
      canvasEnvironment: { displays: { 0: { width: 100, height: 50 } } },
    });
    const gravity = () => effect.simulation.emitters.get(3)!.gravity[1];
    const before = effect.getParticleEnvironment()!;
    effect.updateParticleEnvironment({ gravity: [0, -8, 0] });
    const merged = effect.getParticleEnvironment()!;
    const kept = merged.viewPosition?.join() === '0,0,-5' && merged.fog.mode === 'none';
    const updated = gravity() === -8 && before.gravity?.[1] === -4;
    effect.updateParticleEnvironment({ viewPosition: undefined });
    const removed = effect.getParticleEnvironment()!.viewPosition === undefined;
    let rejected = 0;
    for (const patch of [{ gravity: [NaN, 0, 0] as [number, number, number] }, { fog: undefined }])
      try {
        effect.updateParticleEnvironment(patch as never);
      } catch {
        rejected++;
      }
    effect.updateRenderEnvironment({ globalMipBias: 0 });
    effect.updateCanvasEnvironment({ displays: { 0: { width: 200, height: 50 } } });
    const independent = effect.getParticleEnvironment() !== effect.getParticleEnvironment();
    return {
      kept,
      updated,
      removed,
      rejected,
      independent,
      preserved: gravity() === -8,
      render: effect.getRenderEnvironment(),
      canvas: effect.getCanvasEnvironment()?.displays[0],
      camera: effect.getCameraEnvironment() ?? null,
    };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}
