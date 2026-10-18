import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { expect, it } from 'vitest';
import { vec3 } from 'gl-matrix';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource, vector } from './particle-fixtures.js';
import type { EffectPack } from '../src/pack.js';
import { Space } from '../src/format/generated/noa/ir/space.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';

const native = JSON.parse(readNativeFixture('unity-spaces.json')) as {
  cases: {
    label: string;
    samples: {
      frame: number;
      position: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      world: { x: number; y: number; z: number };
    }[];
  }[];
};
for (const sample of native.cases)
  it('matches Unity simulation space ' + sample.label, () => {
    const document = minimalDocument();
    const sourceNode = document.nodes[0]!;
    const custom = structuredClone(sourceNode);
    custom.id = 9;
    sourceNode.transform!.position!.x = 2;
    sourceNode.transform!.position!.y = 3;
    sourceNode.transform!.rotation!.z = sourceNode.transform!.rotation!.w = Math.SQRT1_2;
    sourceNode.transform!.scale!.x = 2;
    sourceNode.transform!.scale!.y = 3;
    custom.transform!.position!.x = -1;
    custom.transform!.position!.y = 2;
    custom.transform!.rotation!.z = Math.sin(Math.PI / 8);
    custom.transform!.rotation!.w = Math.cos(Math.PI / 8);
    document.nodes.push(custom);
    const pack = {
      nodes: document.nodes,
      components: [],
      getNode: (id: number) => document.nodes.find((n) => n.id === id),
    } as unknown as EffectPack;
    const scene = new Scene(pack, [1, 9]);
    const source = particleSource();
    source.main!.space = sample.label.startsWith('world')
      ? Space.World
      : sample.label.startsWith('custom')
        ? Space.Custom
        : Space.Local;
    source.main!.speed = constant(1);
    source.main!.gravityMultiplier = constant(sample.label.includes('gravity') ? 1 : 0);
    source.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
      ),
    );
    if (sample.label.includes('velocity'))
      source.modules.push(
        new ParticleModuleT(
          M.VelocityModule,
          new VelocityModuleT(vector(1, 2, 0), null, null, null, null, Space.World),
        ),
      );
    const emitter = new Emitter(
      3,
      scene.nodes.get(1)!,
      source,
      true,
      12345,
      [],
      [0, -10, 0],
      scene.nodes.get(9),
    );
    emitter.sync();
    for (const s of sample.samples) {
      if (s.frame) {
        scene.nodes.get(1)!.localMatrix[12]! += 1;
        scene.nodes.get(9)!.localMatrix[13]! += 1;
        scene.update();
        emitter.sync();
        emitter.step(1 / 60);
      }
      const world = vec3.transformMat4(
        vec3.create(),
        emitter.positions.subarray(0, 3),
        emitter.simulationMatrix,
      );
      for (const [i, key] of (['x', 'y', 'z'] as const).entries()) {
        recordError(
          'space.position',
          emitter.positions[i]! - s.position[key],
          'units',
          sample.label + '/' + s.frame + '/' + key,
        );
        recordError(
          'space.velocity',
          emitter.velocities[i]! - s.velocity[key],
          'units/s',
          sample.label + '/' + s.frame + '/' + key,
        );
        recordError(
          'space.world',
          world[i]! - s.world[key],
          'units',
          sample.label + '/' + s.frame + '/' + key,
        );
        expect(Math.abs(emitter.positions[i]! - s.position[key])).toBeLessThan(1e-5);
        expect(Math.abs(emitter.velocities[i]! - s.velocity[key])).toBeLessThan(1e-5);
        expect(Math.abs(world[i]! - s.world[key])).toBeLessThan(1e-5);
      }
    }
  });

it('accepts explicit zero gravity and rejects missing gravity', () => {
  const document = minimalDocument();
  const pack = {
    nodes: document.nodes,
    components: [],
    getNode: (id: number) => document.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const node = new Scene(pack, [1]).nodes.get(1)!;
  const source = particleSource();
  source.main!.gravityMultiplier = constant(1);
  expect(() => new Emitter(3, node, source, true, 1, [])).toThrow('particleEnvironment.gravity');
  expect(() => new Emitter(3, node, source, true, 1, [], [0, 0, 0])).not.toThrow();
});
