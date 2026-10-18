import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive, minimalDocument, encode } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ShapeGeometry } from '../src/format/generated/noa/ir/shape-geometry.js';
import { EdgeShapeT } from '../src/format/generated/noa/ir/edge-shape.js';
import { ScalingMode } from '../src/format/generated/noa/ir/scaling-mode.js';
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
for (const c of native.cases.filter((c) => c.label.startsWith('scaling-birth-')))
  it('matches native birth and motion ' + c.label, async () => {
    const doc = minimalDocument(),
      node = doc.nodes[0]!,
      parent = minimalDocument().nodes[0]!;
    parent.id = 9;
    parent.transform!.scale!.x = 2;
    parent.transform!.scale!.y = 3;
    parent.transform!.scale!.z = 4;
    node.parentId = 9;
    node.transform!.scale!.x = 0.5;
    node.transform!.scale!.y = 2;
    doc.nodes.push(parent);
    doc.entries[0]!.roots = [9];
    const pack = await loadPack(await archive(encode(doc)));
    const s = particleSource();
    s.main!.speed = constant(1);
    s.main!.scaling = c.label.includes('hierarchy')
      ? ScalingMode.Hierarchy
      : c.label.includes('shape')
        ? ScalingMode.Shape
        : ScalingMode.Local;
    s.main!.space = c.label.endsWith('True') ? Space.World : Space.Local;
    const transform = minimalDocument().nodes[0]!.transform!;
    transform.position!.x = 1;
    transform.position!.y = 0.5;
    transform.position!.z = 0.2;
    s.modules.push(
      new ParticleModuleT(
        M.ShapeModule,
        new ShapeModuleT(ShapeGeometry.EdgeShape, new EdgeShapeT(constant(0)), transform),
      ),
    );
    s.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
      ),
    );
    const e = new Emitter(3, new Scene(pack, [9]).nodes.get(1)!, s, true, 1, []);
    e.sync();
    for (const sample of c.samples) {
      if (sample.frame) e.step(1 / 60);
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries())
        for (const field of ['positions', 'velocities'] as const) {
          const error = e[field][axis]! - sample[field][0]![key];
          recordError(
            'scaling.birth.' + field,
            error,
            field === 'positions' ? 'units' : 'units/s',
            c.label + '/' + sample.frame + '/' + key,
          );
          expect(Math.abs(error)).toBeLessThan(0.0002);
        }
    }
  });
