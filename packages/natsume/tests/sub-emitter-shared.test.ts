import { expect, it } from 'vitest';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { subEmitterSupport } from '../src/runtime/sub-emitter-support.js';
import type { ParticleSnapshot } from '../src/runtime/particle-snapshot.js';
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

it('reports independent shared roots without treating duplicate slots or diamonds as extra roots', () => {
  const source = (...targets: number[]) => {
    const system = particleSource();
    system.modules.push(
      new ParticleModuleT(
        M.SubEmittersModule,
        new SubEmittersModuleT(targets.map((id) => new SubEmitterT(id, 0, 0, 1))),
      ),
    );
    return system;
  };
  expect(
    subEmitterSupport(
      new Map([
        [1, source(3)],
        [2, source(3)],
        [3, source()],
      ]),
    ),
  ).toMatchObject([{ code: 'SHARED_SUB_EMITTER_ORDER', severity: 'warning', value: [3] }]);
  expect(
    subEmitterSupport(
      new Map([
        [1, source(2, 2)],
        [2, source()],
      ]),
    ),
  ).toEqual([]);
  expect(
    subEmitterSupport(
      new Map([
        [1, source(2, 3)],
        [2, source(4)],
        [3, source(4)],
        [4, source()],
      ]),
    ),
  ).toEqual([]);
});
const origin: ParticleSnapshot = {
  id: 0,
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  size: [1, 1, 1],
  rotation: [0, 0, 0],
  color: [1, 1, 1, 1],
  age: 0,
  lifetime: 1,
  remainingLifetime: 1,
};
interface Sample {
  frame: number;
  a: number;
  b: number;
  child: number;
  childAge: number[];
}
interface SharedCase {
  lifetimeA: number;
  lifetimeB: number;
  duration: number;
  inherit: number;
  automatic: boolean;
  clearFrame: number;
  topology: number;
  stopMode: number;
  samples: Sample[];
}
function sharedFixture(c: SharedCase) {
  const document = minimalDocument();
  for (let i = 0; i < 4; i++) {
    const node = structuredClone(document.nodes[0]!);
    node.id = 10 + i;
    node.parentId = 1;
    document.nodes.push(node);
  }
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map()),
    scene = new Scene(pack, [1]);
  const systems = [0, 1, 2, 3].map((i) => {
    const s = particleSource(),
      m = s.main!;
    m.durationSeconds = i === 2 ? c.duration : 2;
    m.loop = false;
    m.prewarm = false;
    m.playOnEnable =
      i === 2
        ? c.automatic
        : i === 3
          ? c.topology === 2
          : i === 0
            ? c.topology !== 2
            : c.topology === 0;
    m.lifetime = constant(i === 0 ? c.lifetimeA : i === 1 ? c.lifetimeB : i === 2 ? 0.4 : 1);
    m.speed = constant(0);
    m.maxParticles = 1000;
    s.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(
          constant(i === 2 ? 30 : 0),
          constant(0),
          c.topology === 2 && i < 2 ? [new BurstT(0, constant(1), 1, 0, 1)] : [],
          i === 2 && c.automatic,
        ),
      ),
    );
    let edges: SubEmitterT[] = [];
    if (i === 0)
      edges =
        c.topology === 1
          ? [new SubEmitterT(5, 0, c.inherit, 1), new SubEmitterT(5, 0, c.inherit, 1)]
          : [new SubEmitterT(5, 0, c.inherit, 1)];
    if (i === 1 && c.topology !== 1) edges = [new SubEmitterT(5, 0, c.inherit, 1)];
    if (i === 3 && c.topology === 2)
      edges = [new SubEmitterT(3, 0, 0, 1), new SubEmitterT(4, 0, 0, 1)];
    if (edges.length)
      s.modules.push(new ParticleModuleT(M.SubEmittersModule, new SubEmittersModuleT(edges)));
    return new Emitter(i + 3, scene.nodes.get(10 + i)!, s, true, 12345, []);
  });
  const graph = new SubEmitterGraph(new Map(systems.map((e) => [e.id, e])));
  for (const e of graph.order) e.sync();
  if (c.topology === 2) systems[3]!.emitSubParticles(1, 0, 0, origin, 0);
  else {
    systems[0]!.emitSubParticles(1, 0, 0, origin, 0);
    if (c.topology === 0) systems[1]!.emitSubParticles(1, 0, 0, origin, 0);
  }
  return { systems, graph };
}
function sharedFrame(c: SharedCase, systems: Emitter[], f: number) {
  if (f === 10 && c.topology === 0) {
    systems[1]!.emitSubParticles(1, 0, 0, origin, 0);
  }
  if (f === 12) {
    if (c.stopMode === 1 || c.stopMode === 2 || c.stopMode === 4) systems[0]!.emitting = false;
    if (c.stopMode === 2) systems[0]!.clear();
    if (c.stopMode === 3) {
      systems[0]!.node.activeInHierarchy = false;
      systems[0]!.sync();
    }
    if (c.stopMode === 4) systems[1]!.emitting = false;
  }
  if (f && f === c.clearFrame) systems[0]!.clear();
}
const native = JSON.parse(readNativeFixture('unity-sub-emitter-shared.json')) as {
  cases: SharedCase[];
};
const isolated = JSON.parse(readNativeFixture('unity-sub-emitter-shared-case-52.json')) as {
  cases: SharedCase[];
};
for (const [ci, c] of native.cases.entries()) {
  it.skipIf(ci === 52 && !isolated.cases.length)(
    'matches serial shared pools, duplicate slots and diamonds ' + ci,
    () => {
      const { systems, graph } = sharedFixture(c);
      let maximumAge = 0,
        maximumBatchAge = 0,
        maximumBatchCount = 0;
      for (let f = 0; f <= 120; f++) {
        sharedFrame(c, systems, f);
        if (f) graph.step(1 / 60);
        const emitter = systems[2]!;
        const ages = Array.from(emitter.ages.subarray(0, emitter.count)).sort((a, b) => a - b);
        const batch = c.samples[f]!;
        // The isolated scene removes Unity's unrelated global root-registration ordering.
        const expected = (ci === 52 ? isolated.cases[0]!.samples[f] : batch)!;
        const expectedAges = expected.childAge.slice().sort((a, b) => a - b);
        expect(systems[0]!.count, 'source A, frame=' + f).toBe(expected.a);
        expect(systems[1]!.count, 'source B, frame=' + f).toBe(expected.b);
        expect(emitter.count, 'target, frame=' + f).toBe(expected.child);
        for (let i = 0; i < ages.length; i++)
          maximumAge = Math.max(maximumAge, Math.abs(ages[i]! - expectedAges[i]!));
        maximumBatchCount = Math.max(maximumBatchCount, Math.abs(emitter.count - batch.child));
        if (ages.length === batch.child) {
          const batchAges = batch.childAge.slice().sort((a, b) => a - b);
          for (let i = 0; i < ages.length; i++)
            maximumBatchAge = Math.max(maximumBatchAge, Math.abs(ages[i]! - batchAges[i]!));
        }
      }
      expect(maximumAge).toBeLessThan(2e-6);
      expect(maximumBatchCount).toBe(ci === 52 ? 1 : 0);
      expect(maximumBatchAge).toBeLessThan(ci === 52 ? 1 / 60 + 2e-6 : 2e-6);
      expect(systems[2]!.count).toBe(0);
      recordError(
        'sub-emitter.shared.age',
        maximumAge,
        'seconds',
        'case ' + ci + ', isolated registration for case 52; counts exact',
      );
      recordError(
        'sub-emitter.shared.batch-count',
        maximumBatchCount,
        'particles',
        'case ' + ci + ', 121 frames',
      );
      recordError(
        'sub-emitter.shared.batch-age',
        maximumBatchAge,
        'seconds',
        'case ' + ci + ', 121 frames',
      );
    },
  );
}

const scheduled = JSON.parse(readNativeFixture('unity-sub-emitter-shared-scheduled.json')) as {
  cases: (SharedCase & { samples: (Sample & { updateOrder: number[] })[] })[];
};
for (const [ci, c] of scheduled.cases.entries()) {
  it('matches native shared-pool job execution without per-case exceptions ' + ci, () => {
    const { systems, graph } = sharedFixture(c);
    let maximumAge = 0;
    for (const sample of c.samples) {
      sharedFrame(c, systems, sample.frame);
      if (sample.frame) {
        graph.setUpdateOrder(sample.updateOrder);
        graph.step(1 / 60);
      }
      expect(systems[0]!.count, 'A, frame=' + sample.frame).toBe(sample.a);
      expect(systems[1]!.count, 'B, frame=' + sample.frame).toBe(sample.b);
      const target = systems[2]!;
      expect(target.count, 'child, frame=' + sample.frame).toBe(sample.child);
      const ages = Array.from(target.ages.subarray(0, target.count)).sort((a, b) => a - b);
      const expected = sample.childAge.slice().sort((a, b) => a - b);
      for (let i = 0; i < ages.length; i++)
        maximumAge = Math.max(maximumAge, Math.abs(ages[i]! - expected[i]!));
    }
    expect(maximumAge).toBeLessThan(2e-6);
    recordError(
      'sub-emitter.shared.ordered-age',
      maximumAge,
      'seconds',
      'case ' + ci + '; native job order, 121 frames; counts exact',
    );
  });
}

const schedulingCase: SharedCase = {
  lifetimeA: 0.55,
  lifetimeB: 0.75,
  duration: 2,
  inherit: 0,
  automatic: true,
  clearFrame: 0,
  topology: 0,
  stopMode: 1,
  samples: [],
};

it('makes parent publication between shared-pool updates observable', () => {
  const deferred = sharedFixture(schedulingCase),
    interleaved = sharedFixture(schedulingCase);
  deferred.graph.setUpdateOrder([5, 5, 3, 4, 6]);
  interleaved.graph.setUpdateOrder([5, 3, 5, 4, 6]);
  for (let frame = 1; frame <= 4; frame++) {
    deferred.graph.step(1 / 60);
    interleaved.graph.step(1 / 60);
  }
  const ages = (e: Emitter) => Array.from(e.ages.subarray(0, e.count)).sort((a, b) => a - b);
  const a = ages(deferred.systems[2]!),
    b = ages(interleaved.systems[2]!);
  expect(a).toHaveLength(b.length);
  expect(Math.max(...a.map((age, i) => Math.abs(age - b[i]!)))).toBeCloseTo(1 / 60, 6);
});

it('copies orders, rejects invalid replacements atomically, and restores default scheduling', () => {
  const ordered = sharedFixture(schedulingCase),
    stable = sharedFixture(schedulingCase);
  const order = [5, 5, 3, 4, 6];
  ordered.graph.setUpdateOrder(order);
  order.fill(999);
  for (const invalid of [
    [3, 4, 5, 6],
    [5, 5, 5, 4, 6],
    [5, 5, 3, 4, 999],
    [5, 5, 3, 4, NaN],
    'bad',
  ])
    expect(() => ordered.graph.setUpdateOrder(invalid as never)).toThrow();
  for (let f = 1; f <= 120; f++) {
    sharedFrame(schedulingCase, ordered.systems, f);
    sharedFrame(schedulingCase, stable.systems, f);
    if (f === 20) ordered.graph.setUpdateOrder(undefined);
    ordered.graph.step(1 / 60);
    stable.graph.step(1 / 60);
    expect(ordered.systems.map((e) => [e.count, ...e.ages.subarray(0, e.count)])).toEqual(
      stable.systems.map((e) => [e.count, ...e.ages.subarray(0, e.count)]),
    );
  }
});
