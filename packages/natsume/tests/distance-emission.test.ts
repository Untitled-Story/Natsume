import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { Space } from '../src/format/generated/noa/ir/space.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  cases: { label: string; samples: { frame: number; count: number }[] }[];
};
for (const c of native.cases.filter((c) => c.label.startsWith('distance-')))
  it('matches native birth count ' + c.label, async () => {
    const pack = await loadPack(await archive()),
      scene = new Scene(pack, [1]);
    const s = particleSource();
    s.main!.loop = false;
    s.main!.durationSeconds = 1;
    if (c.label === 'distance-world') s.main!.space = Space.World;
    if (c.label === 'distance-delay') s.main!.startDelay = constant(0.05);
    s.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(constant(0), constant(c.label === 'distance-fractional' ? 1.5 : 2)),
      ),
    );
    const e = new Emitter(3, scene.nodes.get(1)!, s, true, 1, []);
    e.sync();
    for (const sample of c.samples) {
      if (sample.frame) {
        scene.nodes.get(1)!.localMatrix[12] =
          c.label === 'distance-teleport' ? (sample.frame >= 3 ? 10 : 0) : sample.frame * 0.25;
        scene.update();
        e.sync();
        e.step(1 / 60);
      }
      recordError(
        'emission.distance.count',
        e.count - sample.count,
        'particles',
        c.label + '/' + sample.frame,
      );
      expect(Math.abs(e.count - sample.count)).toBeLessThanOrEqual(
        c.label === 'distance-teleport' ? 1 : 0,
      );
    }
  });
