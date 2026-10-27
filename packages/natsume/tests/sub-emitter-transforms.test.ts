import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import { particleInheritanceSnapshot, particleSnapshot } from '../src/runtime/particle-snapshot.js';
import { EffectPack } from '../src/pack.js';
import { Scene } from '../src/runtime/scene.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, vector } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';
import type { Space } from '../src/format/generated/noa/ir/space.js';
import type { ScalingMode } from '../src/format/generated/noa/ir/scaling-mode.js';

interface V {
  x: number;
  y: number;
  z: number;
}
interface TransformData {
  position: V;
  rotation: V & { w: number };
  scale: V;
}
interface NativeParticle {
  position: V;
  size: V;
  rotation: V;
  lifetime: number;
}
interface NativeCase {
  space: Space;
  scaling: ScalingMode;
  inherit: number;
  nonUniform: boolean;
  root: TransformData;
  parent: TransformData;
  target: TransformData;
  custom: TransformData;
  initial: NativeParticle[];
  advanced: NativeParticle[];
}
function fixture(c: NativeCase) {
  const doc = minimalDocument();
  const tr = (v: TransformData) =>
    new TransformT(
      new Vec3T(v.position.x, v.position.y, v.position.z),
      new QuaternionT(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w),
      new Vec3T(v.scale.x, v.scale.y, v.scale.z),
    );
  doc.nodes = [
    new NodeT(1, 'root', 0, true, tr(c.root)),
    new NodeT(2, 'parent', 1, true, tr(c.parent)),
    new NodeT(3, 'target', 2, true, tr(c.target)),
    new NodeT(4, 'custom', 1, true, tr(c.custom)),
  ];
  const scene = new Scene(new EffectPack(doc, { files: [] } as never, new Map(), new Map()), [1]);
  const systems = [true, false].map((parent) => {
    const source = particleSource(),
      main = source.main!;
    main.lifetime = constant(parent ? 0.55 : 0.9);
    main.size3d = true;
    main.size = parent ? vector(1.1, 1.7, 0.6) : vector(0.8, 0.5, 1.2);
    main.rotation3d = true;
    main.rotation = parent ? vector(0.2, -0.1, 0.3) : vector(-0.1, 0.4, -0.2);
    main.space = parent ? 0 : c.space;
    main.scaling = c.scaling;
    main.playOnEnable = parent;
    main.durationSeconds = 2;
    source.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(
          constant(0),
          constant(0),
          [new BurstT(0, constant(parent ? 1 : 2), 1, 0, 1)],
          parent,
        ),
      ),
    );
    if (parent)
      source.modules.push(
        new ParticleModuleT(
          M.SubEmittersModule,
          new SubEmittersModuleT([new SubEmitterT(11, 4, c.inherit, 1)]),
        ),
      );
    return source;
  });
  const emitters = systems.map(
    (source, i) =>
      new Emitter(
        10 + i,
        scene.nodes.get(i + 2)!,
        source,
        true,
        12345,
        [],
        undefined,
        source.main!.space === 2 ? scene.nodes.get(4) : undefined,
      ),
  );
  const graph = new SubEmitterGraph(new Map(emitters.map((e) => [e.id, e])));
  for (const e of emitters) e.sync();
  const parent = emitters[0]!,
    child = emitters[1]!;
  parent.positions.set([0.2, 0.3, 0.4]);
  parent.velocities.set([1, 2, 3]);
  graph.trigger(10, 0);
  return { parent, child, graph };
}
const native: { cases: NativeCase[] } = JSON.parse(
  readNativeFixture('unity-sub-emitter-transforms.json'),
);
it('inherits module size before transform scaling while preserving public world-size snapshots', () => {
  const source = particleSource(),
    doc = minimalDocument();
  doc.nodes[0]!.transform!.scale = new Vec3T(2, 0, 3);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(1), 1, 0, 1)]),
    ),
  );
  source.main!.size3d = true;
  source.main!.size = vector(1.1, 1.7, 0.6);
  const scene = new Scene(new EffectPack(doc, { files: [] } as never, new Map(), new Map()), [1]);
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, []);
  emitter.sync();
  expect(particleInheritanceSnapshot(emitter, 0).size).toEqual([
    Math.fround(1.1),
    Math.fround(1.7),
    Math.fround(0.6),
  ]);
  expect(particleSnapshot(emitter, 0).size).toEqual([
    Math.fround(1.1) * 2,
    0,
    Math.fround(0.6) * 3,
  ]);
});
for (const c of native.cases)
  it(`matches Unity inheritance space=${c.space} scaling=${c.scaling} properties=${c.inherit} nonUniform=${c.nonUniform}`, () => {
    const { child, graph } = fixture(c);
    let position = 0,
      size = 0,
      rotation = 0,
      lifetime = 0;
    const compare = (expected: NativeParticle[]) => {
      expect(child.count).toBe(expected.length);
      for (let i = 0; i < child.count; i++) {
        const sample = expected[i]!;
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          position = Math.max(
            position,
            Math.abs(child.positions[i * 3 + axis]! - sample.position[key]),
          );
          size = Math.max(size, Math.abs(child.startSizes[i * 3 + axis]! - sample.size[key]));
          rotation = Math.max(
            rotation,
            Math.abs(child.rotations[i * 3 + axis]! - sample.rotation[key]),
          );
        }
        lifetime = Math.max(lifetime, Math.abs(child.lifetimes[i]! - sample.lifetime));
      }
    };
    compare(c.initial);
    graph.step(1 / 60);
    compare(c.advanced);
    expect(position).toBeLessThan(2e-5);
    expect(size).toBeLessThan(2e-6);
    expect(rotation).toBeLessThan(2e-6);
    expect(lifetime).toBeLessThan(2e-6);
    const label = `space=${c.space}, scaling=${c.scaling}, properties=${c.inherit}, nonUniform=${c.nonUniform}`;
    recordError('sub-emitter.transforms.position', position, 'scene units', label);
    recordError('sub-emitter.transforms.size', size, 'particle units', label);
    recordError('sub-emitter.transforms.rotation', rotation, 'radians', label);
    recordError('sub-emitter.transforms.lifetime', lifetime, 'seconds', label);
  });
