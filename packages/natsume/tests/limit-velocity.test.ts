import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive, minimalDocument, encode } from './helpers.js';
import { constant, particleSource, vector, manualParticle, linear } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { LimitVelocityModuleT } from '../src/format/generated/noa/ir/limit-velocity-module.js';
import { SizeModuleT } from '../src/format/generated/noa/ir/size-module.js';
import { Space } from '../src/format/generated/noa/ir/space.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

interface V {
  x: number;
  y: number;
  z: number;
}
const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  cases: { label: string; samples: { frame: number; positions: V[]; velocities: V[] }[] }[];
};
for (const c of native.cases.filter((c) => c.label.startsWith('limit-')))
  it('matches Unity ' + c.label, async () => {
    const doc = minimalDocument();
    if (c.label.includes('world')) {
      const angle =
        ((c.label.includes('negative') ? -45 : c.label.includes('angle30') ? 30 : 45) * Math.PI) /
        180;
      doc.nodes[0]!.transform!.rotation!.z = Math.sin(angle / 2);
      doc.nodes[0]!.transform!.rotation!.w = Math.cos(angle / 2);
    }
    const pack = await loadPack(await archive(encode(doc)));
    const source = particleSource();
    const l = new LimitVelocityModuleT();
    l.dampen = c.label.endsWith('dampen0') ? 0 : c.label.endsWith('dampen1') ? 1 : 0.26;
    l.separateAxes = c.label.includes('axes');
    l.limit = l.separateAxes ? vector(0.4, 0.2, 0.1) : vector(100);
    l.space = c.label.includes('world') && !c.label.includes('local') ? Space.World : Space.Local;
    if (c.label.includes('simworld')) source.main!.space = Space.World;
    l.drag = constant(c.label.includes('drag') ? 0.7 : 0);
    l.multiplyDragBySize = /size|both/.test(c.label);
    l.multiplyDragByVelocity = /velocity|both/.test(c.label);
    source.modules.push(new ParticleModuleT(M.LimitVelocityModule, l));
    if (c.label.endsWith('size-lifetime')) {
      const size = vector();
      size.x = linear(0.5, 2);
      source.modules.push(new ParticleModuleT(M.SizeModule, new SizeModuleT(size)));
    }
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
    manualParticle(e);
    e.velocities.set([2, 1, 0.5]);
    e.lifetimes[0] = 2;
    for (let frame = 0; frame <= 60; frame++) {
      if (frame) e.step(1 / 60);
      const s = c.samples.find((s) => s.frame === frame);
      if (!s) continue;
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries())
        for (const field of ['positions', 'velocities'] as const) {
          const error = e[field][axis]! - s[field][0]![key];
          recordError(
            'limit.' + c.label.slice(6) + '.' + field,
            error,
            field === 'positions' ? 'units' : 'units/s',
            frame + '/' + key,
          );
          expect(Math.abs(error)).toBeLessThan(0.00003);
        }
    }
  });

it('keeps drag finite at rest and prevents speed reversal', async () => {
  const pack = await loadPack(await archive());
  const source = particleSource();
  const l = new LimitVelocityModuleT(vector(100), false, Space.Local, 0, constant(1e5), true, true);
  source.modules.push(new ParticleModuleT(M.LimitVelocityModule, l));
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 1, []);
  manualParticle(e);
  e.step(1 / 60);
  expect(Array.from(e.velocities.slice(0, 3))).toEqual([0, 0, 0]);
  e.step(1 / 60);
  expect(Array.from(e.velocities.slice(0, 3))).toEqual([0, 0, 0]);
});
