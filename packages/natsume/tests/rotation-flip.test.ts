import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { constant, particleSource, vector } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { RotationModuleT } from '../src/format/generated/noa/ir/rotation-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  cases: {
    label: string;
    samples: { frame: number; rotations: { x: number; y: number; z: number }[] }[];
  }[];
};
for (const c of native.cases.filter((c) => c.label.startsWith('flip-rotation-')))
  it('matches native start and lifetime ' + c.label, async () => {
    const pack = await loadPack(await archive());
    const s = particleSource();
    const axes = c.label.includes('True');
    s.main!.rotation3d = axes;
    s.main!.rotation = vector(0.2, 0.4, 0.7);
    s.main!.flipRotationProbability = c.label.endsWith('-1') ? 1 : 0;
    s.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
      ),
    );
    s.modules.push(
      new ParticleModuleT(M.RotationModule, new RotationModuleT(vector(0.1, 0.3, 0.5), axes)),
    );
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, s, true, 123, []);
    e.sync();
    for (const sample of c.samples) {
      if (sample.frame) e.step(1 / 60);
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
        const error = e.rotations[axis]! - (sample.rotations[0]![key] * Math.PI) / 180;
        recordError('rotation.flip', error, 'rad', c.label + '/' + sample.frame + '/' + key);
        expect(Math.abs(error)).toBeLessThan(1e-6);
      }
    }
  });
