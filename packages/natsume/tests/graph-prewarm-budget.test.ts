import { expect, it } from 'vitest';
import { graphPrewarmEstimate, instancePrewarmWork } from '../src/runtime/prewarm.js';
import { Simulation } from '../src/runtime/simulation.js';
import { checkCompatibility } from '../src/runtime/compatibility.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';

function fixture() {
  const root = particleSource();
  root.main!.durationSeconds = 1;
  root.main!.loop = root.main!.prewarm = true;
  root.main!.maxParticles = 100;
  root.main!.lifetime = constant(1);
  root.modules.push(
    new ParticleModuleT(
      M.SubEmittersModule,
      new SubEmittersModuleT([new SubEmitterT(4), new SubEmitterT(4), new SubEmitterT(0)]),
    ),
  );
  const child = particleSource();
  child.main!.lifetime = constant(100);
  child.main!.maxParticles = 100;
  return {
    root,
    child,
    systems: new Map([
      [3, root],
      [4, child],
    ]),
  };
}

it('counts a shared target once per warm scope and includes its longer lifetime', () => {
  const { systems } = fixture();
  expect(instancePrewarmWork(systems, new Set([3, 4]))).toBe(1_010_400);
  expect(instancePrewarmWork(systems, new Set([4]))).toBe(0);
});

it('rejects excessive connected warm work during preflight before allocating particle storage', () => {
  const { root, child } = fixture();
  root.main!.maxParticles = child.main!.maxParticles = 100_000;
  const document = minimalDocument();
  document.components = [
    new ComponentT(3, 1, true, ComponentData.ParticleSystem, root),
    new ComponentT(4, 1, true, ComponentData.ParticleSystem, child),
  ];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const report = checkCompatibility(
    pack,
    {},
    {
      maxTextureSize: 4096,
      availableTexturePixels: 64 * 1024 * 1024,
      cachedMaterialIds: new Set(),
      imageBitmapAvailable: true,
      hasScript: () => false,
      disposed: false,
    },
  );
  expect(report.issues).toContainEqual(
    expect.objectContaining({
      code: 'LIMIT',
      field: 'prewarm',
      value: 1_010_400_000,
    }),
  );
  expect(() => new Simulation(pack)).toThrow('Instance prewarm work exceeds playback budget');
});

it('accumulates authored Float32 lifetimes from root to leaf', () => {
  const { root, child, systems } = fixture();
  const grand = particleSource();
  root.main!.lifetime = constant(Math.fround(0.17));
  child.main!.lifetime = constant(Math.fround(0.65));
  grand.main!.lifetime = constant(Math.fround(0.9));
  child.modules.push(
    new ParticleModuleT(M.SubEmittersModule, new SubEmittersModuleT([new SubEmitterT(5)])),
  );
  systems.set(5, grand);
  const expected = Math.fround(
    Math.fround(Math.fround(0.17) + Math.fround(0.65)) + Math.fround(0.9),
  );
  expect(graphPrewarmEstimate(3, systems).history).toBe(expected);
  expect(expected).not.toBe(
    Math.fround(Math.fround(0.17) + Math.fround(Math.fround(0.65) + Math.fround(0.9))),
  );
});

it('uses the longest branch without adding sibling lifetimes', () => {
  const { root, child, systems } = fixture();
  const sibling = particleSource();
  root.main!.lifetime = constant(1);
  child.main!.lifetime = constant(2);
  sibling.main!.lifetime = constant(4);
  const module = root.modules.find((m) => m.dataType === M.SubEmittersModule)!
    .data as SubEmittersModuleT;
  module.emitters.push(new SubEmitterT(5));
  systems.set(5, sibling);
  expect(graphPrewarmEstimate(3, systems).history).toBe(5);
});
