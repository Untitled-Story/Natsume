import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';

it('integrates Birth descendants through the source partial step, including zero-age births', () => {
  const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]);
  const source = particleSource(),
    target = particleSource();
  source.main!.playOnEnable = true;
  source.modules.push(
    new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(80), constant(0), [])),
    new ParticleModuleT(M.SubEmittersModule, new SubEmittersModuleT([new SubEmitterT(4, 0, 0, 1)])),
  );
  target.main!.playOnEnable = false;
  target.main!.lifetime = constant(0.5);
  target.main!.speed = constant(1);
  target.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(1), 1, 0, 1)], false),
    ),
  );
  const parent = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, []);
  const child = new Emitter(4, scene.nodes.get(1)!, target, true, 12345, []);
  parent.enableLifetimeProgress();
  child.enableLifetimeProgress();
  const graph = new SubEmitterGraph(
    new Map([
      [3, parent],
      [4, child],
    ]),
  );
  parent.sync();
  child.sync();
  for (let frame = 1; frame <= 4; frame++) {
    graph.step(1 / 60);
    expect(child.count).toBe(parent.count);
    for (let i = 0; i < child.count; i++) {
      // Both particles were born at the same instant. Getter rounding depends on lifetime.
      expect(Math.abs(child.ages[i]! - parent.ages[i]!)).toBeLessThan(1.2e-7);
      expect(child.positions[i * 3 + 2]).toBeCloseTo(child.ages[i]!, 6);
    }
  }
});
