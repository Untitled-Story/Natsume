import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive, minimalDocument, encode } from './helpers.js';
import { constant, particleSource, vector, manualParticle } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { Space } from '../src/format/generated/noa/ir/space.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  cases: {
    label: string;
    samples: {
      frame: number;
      positions: { x: number; y: number; z: number }[];
      velocities: { x: number; y: number; z: number }[];
    }[];
  }[];
};
for (const c of native.cases.filter((c) => c.label.startsWith('velocity-')))
  it('matches native orbital and radial space ' + c.label, async () => {
    const doc = minimalDocument(),
      tr = doc.nodes[0]!.transform!;
    tr.rotation!.z = Math.sin(Math.PI / 8);
    tr.rotation!.w = Math.cos(Math.PI / 8);
    if (c.label.includes('scaled')) {
      tr.scale!.x = 2;
      tr.scale!.y = 3;
    }
    if (c.label.includes('translated')) {
      tr.position!.x = 2;
      tr.position!.y = 3;
      tr.position!.z = 4;
    }
    const pack = await loadPack(await archive(encode(doc))),
      s = particleSource();
    if (c.label.includes('worldsim')) s.main!.space = Space.World;
    const v = new VelocityModuleT();
    v.space = c.label.includes('velocity-world') ? Space.World : Space.Local;
    v.orbital = c.label.includes('radial') ? vector() : vector(1, 0.5, 0.7);
    v.orbitalOffset = /offset|combined|translated/.test(c.label)
      ? vector(0.2, -0.3, 0.4)
      : vector();
    v.radial = constant(/radial|combined|translated/.test(c.label) ? 0.4 : 0);
    v.linear = c.label.includes('combined') ? vector(1, 2, 3) : vector();
    v.speedMultiplier = constant(c.label.includes('combined') ? 2 : 1);
    s.modules.push(new ParticleModuleT(M.VelocityModule, v));
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, s, true, 1, []);
    manualParticle(e);
    e.velocities.set([2, 1, 0.5]);
    e.lifetimes[0] = 2;
    for (let frame = 0; frame <= 60; frame++) {
      if (frame) e.step(1 / 60);
      const sample = c.samples.find((s) => s.frame === frame);
      if (!sample) continue;
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries())
        for (const field of ['positions', 'velocities'] as const) {
          const error = e[field][axis]! - sample[field][0]![key];
          recordError(
            'velocity.space.' + field,
            error,
            field === 'positions' ? 'units' : 'units/s',
            c.label + '/' + frame + '/' + key,
          );
          expect(Math.abs(error), c.label + '/' + frame + '/' + field + '/' + key).toBeLessThan(
            0.00004,
          );
        }
    }
  });
