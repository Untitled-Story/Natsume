import { existsSync, readFileSync } from 'node:fs';
import { recordError } from './measurement.js';
import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import { particleSnapshot, type ParticleSnapshot } from '../src/runtime/particle-snapshot.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, vector } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { Space } from '../src/format/generated/noa/ir/space.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ShapeGeometry } from '../src/format/generated/noa/ir/shape-geometry.js';
import { BoxShapeT } from '../src/format/generated/noa/ir/box-shape.js';
import type { ParticleSystemT } from '../src/format/generated/noa/ir/particle-system.js';

const origin: ParticleSnapshot = {
  id: 0,
  position: [3.2, 4.3, 5.4],
  velocity: [1, 2, 3],
  size: [1, 1, 1],
  rotation: [0, 0, 0],
  color: [1, 1, 1, 1],
  age: 0,
  lifetime: 1,
  remainingLifetime: 1,
};

function fixture(
  event = 0,
  inherit = 0,
  space = 0,
  emission = true,
  play = false,
  probability = 1,
  kind = 0,
  slots?: SubEmitterT[],
  lifecycle?: LifecycleCase,
) {
  const document = minimalDocument();
  document.nodes[0]!.transform!.position = new Vec3T(3, 4, 5);
  document.nodes.push(
    new NodeT(
      2,
      'child',
      1,
      true,
      new TransformT(new Vec3T(7, 8, 9), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
    ),
  );
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]);
  const parentSource = particleSource(),
    childSource = particleSource();
  parentSource.main!.lifetime = constant(kind ? 0.5 : 0.1);
  parentSource.main!.size = vector(2, 2, 2);
  parentSource.main!.rotation = vector(0, 0, 0.5);
  parentSource.main!.color = new ColorParameterT(0, null, new ColorT(0.2, 0.4, 0.6, 0.8));
  parentSource.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(1), 1, 0, 1)]),
    ),
    new ParticleModuleT(
      M.ShapeModule,
      new ShapeModuleT(
        ShapeGeometry.BoxShape,
        new BoxShapeT(new Vec3T()),
        new TransformT(new Vec3T(0.2, 0.3, 0.4), new QuaternionT(0, 0, 0, 1), new Vec3T(0, 0, 0)),
      ),
    ),
  );
  parentSource.modules.push(
    new ParticleModuleT(
      M.SubEmittersModule,
      new SubEmittersModuleT(slots ?? [new SubEmitterT(4, event, inherit, probability)]),
    ),
  );
  childSource.main!.lifetime = constant(0.8);
  childSource.main!.size = vector(0.4, 0.4, 0.4);
  childSource.main!.rotation = vector(0, 0, 0.2);
  childSource.main!.color = new ColorParameterT(0, null, new ColorT(0.5, 0.6, 0.7, 0.5));
  childSource.main!.space = space as Space;
  childSource.main!.playOnEnable = play;
  childSource.main!.durationSeconds = kind ? 0.2 : 2;
  childSource.main!.loop = kind === 3 || kind === 6;
  childSource.main!.startDelay = constant(kind === 5 ? 0.05 : 0);
  childSource.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(
        constant(kind && kind !== 2 && kind !== 6 ? 30 : 0),
        constant(kind === 6 ? 10 : 0),
        !kind || kind === 2 ? [new BurstT(kind === 2 ? 0.05 : 0, constant(2), 1, 0, 1)] : [],
        emission,
      ),
    ),
  );
  if (lifecycle) {
    parentSource.main!.lifetime = constant(lifecycle.lifetime);
    parentSource.main!.durationSeconds = 1;
    parentSource.main!.prewarm = lifecycle.name === 'prewarm';
    parentSource.main!.loop = lifecycle.name === 'prewarm';
    const parentEmission = parentSource.modules.find((m) => m.dataType === M.EmissionModule)!
      .data as EmissionModuleT;
    parentEmission.rateOverTime = constant(lifecycle.name === 'prewarm' ? 10 : 0);
    parentEmission.bursts =
      lifecycle.name === 'prewarm' ? [] : [new BurstT(0, constant(1), 1, 0, 1)];
    childSource.main!.durationSeconds = lifecycle.duration;
    childSource.main!.lifetime = constant(lifecycle.childLifetime);
    childSource.main!.maxParticles = 1000;
    childSource.main!.loop = lifecycle.loop;
    const childEmission = childSource.modules.find((m) => m.dataType === M.EmissionModule)!
      .data as EmissionModuleT;
    childEmission.rateOverTime = constant(lifecycle.name === 'prewarm' ? 0 : 30);
    childEmission.bursts =
      lifecycle.name === 'prewarm' ? [new BurstT(0, constant(2), 1, 0, 1)] : [];
  }
  const parent = new Emitter(3, scene.nodes.get(1)!, parentSource, true, 12345, []);
  const child = new Emitter(4, scene.nodes.get(2)!, childSource, true, 54321, []);
  // Reverse insertion tests that scheduling follows edges rather than component IDs/order.
  const graph = new SubEmitterGraph(
    new Map([
      [4, child],
      [3, parent],
    ]),
  );
  parent.sync();
  child.sync();
  parent.velocities.set([1, 2, 3]);
  return { parent, child, graph };
}

it('triggers saved bursts with disabled automatic emission and validates stable particle IDs', () => {
  const { parent, child, graph } = fixture(4, 31, 1, false);
  graph.trigger(3, 0, 0);
  expect(child.count).toBe(2);
  const sample = particleSnapshot(child, 0);
  expect(sample.position).toEqual(origin.position.map(Math.fround));
  expect(sample.size[0]).toBeCloseTo(0.8);
  expect(sample.rotation[2]).toBeCloseTo(0.7);
  expect(sample.lifetime).toBeCloseTo(0.08);
  expect(() => graph.trigger(3, 0, 999)).toThrow('no longer alive');
  expect(() => graph.trigger(3, -1)).toThrow('slot');
  parent.clear();
  expect(() => graph.trigger(3, 0, 0)).toThrow('no longer alive');
});

it('preserves empty and duplicate slots, event probability, and resets stale Birth channels', () => {
  const { parent, child, graph } = fixture(0, 0, 0, false, false, 1, 0, [
    new SubEmitterT(0, 0, 0, 1),
    new SubEmitterT(4, 0, 0, 1),
    new SubEmitterT(4, 0, 0, 1),
    new SubEmitterT(4, 0, 0, 0),
  ]);
  graph.trigger(3, 0);
  graph.step(1 / 60);
  expect(child.count).toBe(4);
  parent.reset();
  child.reset();
  graph.clear();
  parent.sync();
  child.sync();
  graph.step(1 / 60);
  expect(child.count).toBe(4);
  graph.trigger(3, 3);
  expect(child.count).toBe(4);
  graph.trigger(3, 1);
  expect(child.count).toBe(6);
});

it('supports a shared target without cloning storage or overwriting its authored configuration', () => {
  const { parent, child } = fixture(4, 0, 0, false);
  const second = new Emitter(5, parent.node, parent.source, true, 77, []);
  const graph = new SubEmitterGraph(
    new Map([
      [4, child],
      [5, second],
      [3, parent],
    ]),
  );
  second.sync();
  const authored = child.main;
  graph.trigger(3, 0);
  graph.trigger(5, 0);
  expect(child.count).toBe(4);
  expect(child.main).toBe(authored);
  expect(child.emission!.enabled).toBe(false);
  expect(new Set(Array.from(child.serials.slice(0, 4))).size).toBe(4);
});

it('propagates same-frame births through a DAG, respects target capacity and replays without stale channels', () => {
  const { parent, child } = fixture();
  const grandSource = particleSource();
  grandSource.main!.playOnEnable = false;
  grandSource.main!.maxParticles = 4;
  grandSource.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(3), 1, 0, 1)], false),
    ),
  );
  (child.source as ParticleSystemT).modules.push(
    new ParticleModuleT(M.SubEmittersModule, new SubEmittersModuleT([new SubEmitterT(5, 0, 0, 1)])),
  );
  parent.reset();
  child.reset();
  const grand = new Emitter(5, child.node, grandSource, true, 91, []);
  const graph = new SubEmitterGraph(
    new Map([
      [5, grand],
      [4, child],
      [3, parent],
    ]),
  );
  for (let round = 0; round < 2; round++) {
    for (const e of graph.order) e.sync();
    graph.step(1 / 60);
    expect(child.count).toBe(2);
    expect(grand.count).toBe(4);
    expect(new Set(grand.serials.slice(0, 4)).size).toBe(4);
    expect(Array.from(grand.subParentParticles!.slice(0, 4))).toEqual([0, 0, 0, 1]);
    graph.clear();
    for (const e of graph.order) e.reset();
  }
});

interface NativeParticle {
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number; a: number };
  lifetime: number;
  remaining: number;
}
interface NativeCase {
  eventType: number;
  inherit: number;
  space: number;
  emission: boolean;
  play: boolean;
  probability: number;
  kind: number;
  samples: { frame: number; child: NativeParticle[] }[];
}
interface LifecycleCase {
  name: string;
  inherit: number;
  lifetime: number;
  duration: number;
  childLifetime: number;
  loop: boolean;
  samples: { frame: number; parent: NativeParticle[]; child: NativeParticle[] }[];
}
const nativePath = new URL(
  '../../../data/unity-baselines/sub-emitters/unity-2022.3.21f1.json',
  import.meta.url,
);
it.skipIf(!existsSync(nativePath))(
  'retains target duration and lifetime in measured native Duration inheritance cases',
  () => {
    const { lifecycle } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      lifecycle: LifecycleCase[];
    };
    let countError = 0;
    for (const c of lifecycle.filter((c) => c.name === 'duration')) {
      const { child, graph } = fixture(0, c.inherit, 0, false, false, 1, 0, undefined, c);
      for (let frame = 1; frame <= 120; frame++) {
        graph.step(1 / 60);
        const sample = c.samples[frame]!;
        const error = Math.abs(child.count - sample.child.length);
        countError = Math.max(countError, error);
        expect(
          error,
          `inherit=${c.inherit}, life=${c.lifetime}, duration=${c.duration}, loop=${c.loop}, frame=${frame}`,
        ).toBeLessThanOrEqual(1);
        for (let i = 0; i < child.count; i++)
          expect(child.lifetimes[i]).toBeCloseTo(c.childLifetime, 6);
      }
    }
    recordError(
      'sub-emitter.duration.count',
      countError,
      'particles',
      '24 cases, 120 frames; continuous-rate frame boundary differences',
    );
  },
);
it.skipIf(!existsSync(nativePath))(
  'warms descendants of expired parents and bounds known birth/death boundary differences',
  () => {
    const { lifecycle } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      lifecycle: LifecycleCase[];
    };
    let countError = 0,
      ageError = 0,
      boundaryFrames = 0,
      parentCountError = 0,
      frames = 0;
    for (const c of lifecycle.filter((c) => c.name === 'prewarm')) {
      const { parent, child, graph } = fixture(0, c.inherit, 0, false, false, 1, 0, undefined, c);
      graph.warm();
      for (let frame = 0; frame <= 120; frame++) {
        if (frame > 0) graph.step(1 / 60);
        const sample = c.samples[frame]!;
        frames++;
        parentCountError = Math.max(
          parentCountError,
          Math.abs(parent.count - sample.parent.length),
        );
        expect(Math.abs(parent.count - sample.parent.length)).toBeLessThanOrEqual(1);
        const difference = Math.abs(child.count - sample.child.length);
        countError = Math.max(countError, difference);
        if (difference) boundaryFrames++;
        expect(
          difference,
          `life=${c.lifetime}, childLife=${c.childLifetime}, frame=${frame}`,
        ).toBeLessThanOrEqual(frame === 0 ? 0 : 2);
        const actual = Array.from(child.ages.subarray(0, child.count)).sort((a, b) => a - b);
        const expected = sample.child.map((p) => p.lifetime - p.remaining).sort((a, b) => a - b);
        // A count mismatch is permitted only at birth/death, never in an interior cohort.
        let a = 0,
          b = 0;
        while (a < actual.length && b < expected.length) {
          if (Math.abs(actual[a]! - expected[b]!) > 1 / 60 + 2e-5 && actual[a]! < 1 / 60 + 2e-5) {
            a++;
            continue;
          }
          if (Math.abs(actual[a]! - expected[b]!) > 1 / 60 + 2e-5 && expected[b]! < 1 / 60 + 2e-5) {
            b++;
            continue;
          }
          const error = Math.abs(actual[a++]! - expected[b++]!);
          ageError = Math.max(ageError, error);
          expect(error, `life=${c.lifetime}, frame=${frame}`).toBeLessThan(1 / 60 + 2e-5);
        }
        for (const age of [...actual.slice(a), ...expected.slice(b)])
          expect(
            Math.abs(age - c.childLifetime),
            `life=${c.lifetime}, frame=${frame}`,
          ).toBeLessThan(1 / 60 + 2e-5);
      }
    }
    recordError(
      'sub-emitter.prewarm.count',
      countError,
      'particles',
      `${boundaryFrames}/${frames} frames differ; initial child counts exact`,
    );
    recordError(
      'sub-emitter.prewarm.age',
      ageError,
      'seconds',
      `12 cases, ${frames} frames; unmatched endpoint cohorts excluded`,
    );
    recordError(
      'sub-emitter.prewarm.parent-count',
      parentCountError,
      'particles',
      `${frames} frames`,
    );
  },
);
it.skipIf(!existsSync(nativePath))(
  'places distance births along the native parent path with partial-step age',
  () => {
    const { lifecycle } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      lifecycle: LifecycleCase[];
    };
    let positionError = 0,
      lifetimeError = 0;
    for (const c of lifecycle.filter((c) => c.name === 'distance')) {
      const { child, graph } = fixture(0, c.inherit, 0, false, false, 1, 6);
      for (let frame = 1; frame <= 120; frame++) {
        graph.step(1 / 60);
        const sample = c.samples[frame]!;
        expect(child.count, `frame=${frame}`).toBe(sample.child.length);
        for (let i = 0; i < child.count; i++) {
          const actual = particleSnapshot(child, i),
            expected = sample.child[i]!;
          for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
            const error = Math.abs(
              actual.position[axis]! - origin.position[axis]! - expected.position[key],
            );
            positionError = Math.max(positionError, error);
            expect(error, `frame=${frame}, particle=${i}`).toBeLessThan(2e-5);
          }
          const error = Math.abs(actual.remainingLifetime - expected.remaining);
          lifetimeError = Math.max(lifetimeError, error);
          expect(error, `frame=${frame}, particle=${i}`).toBeLessThan(2e-5);
        }
      }
    }
    recordError(
      'sub-emitter.distance.position',
      positionError,
      'scene units',
      '2 cases, 120 frames',
    );
    recordError('sub-emitter.distance.lifetime', lifetimeError, 'seconds', '2 cases, 120 frames');
  },
);
it.skipIf(!existsSync(nativePath))(
  'matches native bursts and inheritance, while bounding measured continuous-rate frame differences',
  () => {
    const cases = (JSON.parse(readFileSync(nativePath, 'utf8')) as { cases: NativeCase[] }).cases;
    let countError = 0,
      positionError = 0,
      lifetimeError = 0,
      rotationError = 0,
      sizeError = 0,
      colorError = 0;
    let comparisons = 0;
    for (const c of cases.filter((c) => !c.play && c.probability !== 0.5)) {
      const { child, graph } = fixture(
        c.eventType,
        c.inherit,
        c.space,
        c.emission,
        c.play,
        c.probability,
        c.kind,
      );
      if (c.eventType === 4) graph.trigger(3, 0);
      for (let frame = 1; frame <= 60; frame++) {
        graph.step(1 / 60);
        const sample = c.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        const label = JSON.stringify({
          event: c.eventType,
          inherit: c.inherit,
          kind: c.kind,
          space: c.space,
          frame,
        });
        if (c.kind === 3 || c.kind === 5) {
          countError = Math.max(countError, Math.abs(child.count - sample.child.length));
          expect(Math.abs(child.count - sample.child.length), label).toBeLessThanOrEqual(1);
          continue;
        }
        expect(child.count, label).toBe(sample.child.length);
        for (let i = 0; i < child.count; i++) {
          const actual = particleSnapshot(child, i),
            expected = sample.child[i]!;
          comparisons++;
          for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
            const m = child.simulationMatrix;
            const pos = [expected.position.x, expected.position.y, expected.position.z];
            const world =
              m[axis]! * pos[0]! + m[4 + axis]! * pos[1]! + m[8 + axis]! * pos[2]! + m[12 + axis]!;
            positionError = Math.max(positionError, Math.abs(actual.position[axis]! - world));
            sizeError = Math.max(sizeError, Math.abs(actual.size[axis]! - expected.size[key]));
            rotationError = Math.max(
              rotationError,
              Math.abs(actual.rotation[axis]! - (expected.rotation[key] * Math.PI) / 180),
            );
            expect(Math.abs(actual.position[axis]! - world), label).toBeLessThan(2e-5);
            expect(Math.abs(actual.size[axis]! - expected.size[key]), label).toBeLessThan(1e-5);
            expect(
              Math.abs(actual.rotation[axis]! - (expected.rotation[key] * Math.PI) / 180),
              label,
            ).toBeLessThan(1e-5);
          }
          expect(Math.abs(actual.lifetime - expected.lifetime), label).toBeLessThan(2e-5);
          lifetimeError = Math.max(
            lifetimeError,
            Math.abs(actual.lifetime - expected.lifetime),
            Math.abs(actual.remainingLifetime - expected.remaining),
          );
          expect(Math.abs(actual.remainingLifetime - expected.remaining), label).toBeLessThan(2e-5);
          for (const [channel, key] of (['r', 'g', 'b', 'a'] as const).entries()) {
            colorError = Math.max(
              colorError,
              Math.abs(actual.color[channel]! - expected.color[key]),
            );
            expect(Math.abs(actual.color[channel]! - expected.color[key]), label).toBeLessThan(
              1.01 / 255,
            );
          }
        }
      }
    }
    for (const [key, value, unit] of [
      ['count', countError, 'particles'],
      ['position', positionError, 'scene units'],
      ['size', sizeError, 'scene units'],
      ['rotation', rotationError, 'radians'],
      ['lifetime', lifetimeError, 'seconds'],
      ['color', colorError, 'channel units'],
    ] as const)
      recordError(
        `sub-emitter.${key}`,
        value,
        unit,
        `${comparisons} compared particle samples; loop/delay rates count-only`,
      );
  },
);
