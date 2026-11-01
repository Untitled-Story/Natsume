import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { Emitter } from '../src/runtime/emitter.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import type { ParticleSnapshot } from '../src/runtime/particle-snapshot.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, vector } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
const snapshot: ParticleSnapshot = {
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
function setup(mode: number, range: { x: number; y: number }, lifetime = 1, accelerated = false) {
  const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]),
    source = particleSource(),
    target = particleSource();
  source.main!.ringBuffer = mode;
  source.main!.ringBufferLoopRange = new I.Vec2T(range.x, range.y);
  source.main!.lifetime = constant(lifetime);
  source.main!.maxParticles = 3;
  source.main!.playOnEnable = true;
  source.main!.durationSeconds = 1;
  source.main!.loop = true;
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.SubEmittersModule,
      new I.SubEmittersModuleT([new I.SubEmitterT(4, I.SubEmitterEvent.Death, 0, 1)]),
    ),
  );
  target.main!.playOnEnable = false;
  target.main!.lifetime = constant(100);
  target.main!.space = I.Space.World;
  target.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(
        constant(0),
        constant(0),
        [new I.BurstT(0, constant(1), 1, 0, 1)],
        false,
      ),
    ),
  );
  if (accelerated) {
    source.main!.gravityMultiplier = constant(0.3);
    source.main!.gravity = new I.Vec3T(0, -9.81, 0);
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.ForceModule,
        new I.ForceModuleT(vector(1.5, 0, 0), I.Space.Local, false),
      ),
    );
  }
  const e = new Emitter(3, scene.nodes.get(1)!, source, true, 123, []),
    child = new Emitter(4, scene.nodes.get(1)!, target, true, 123, []);
  const graph = new SubEmitterGraph(
    new Map([
      [3, e],
      [4, child],
    ]),
  );
  e.sync();
  child.sync();
  let serial = 0;
  const emit = (amount: number) => {
    for (let i = 0; i < amount; i++) {
      e.emitSubParticles(1, 0, 0, { ...snapshot, position: [serial++ * 10, 0, 0] }, 0);
      const newest = Array.from(e.serials.subarray(0, e.count)).indexOf(serial - 1);
      if (newest >= 0) e.velocities[newest * 3] = 1;
    }
  };
  return { pack, e, child, graph, emit };
}
interface NativeCase {
  accelerated: boolean;
  mode: number;
  range: { x: number; y: number };
  frames: {
    delta: number;
    births: number;
    time: number;
    positions: { x: number; y: number; z: number }[];
    ages: number[];
    deathParticles: number;
    deathPositions: { x: number; y: number; z: number }[];
  }[];
}
const native = JSON.parse(readNativeFixture('unity-particle-ring-buffer.json')) as {
  cases: NativeCase[];
};
it('matches native age wrapping, movement, circular replacement and retired Death particles', () => {
  let maxPosition = 0,
    maxAge = 0,
    maxDeathPosition = 0;
  for (const c of native.cases) {
    const { pack, e, child, graph, emit } = setup(c.mode, c.range, 1, c.accelerated);
    try {
      for (const frame of c.frames) {
        if (frame.delta) graph.step(frame.delta);
        emit(frame.births);
        expect(e.count).toBe(frame.ages.length);
        expect(child.count).toBe(frame.deathParticles);
        for (let i = 0; i < e.count; i++) {
          const ageError = Math.abs(e.ages[i]! - frame.ages[i]!);
          const width = c.range.y - c.range.x;
          maxAge = Math.max(
            maxAge,
            c.mode === 2 && width > 0 ? Math.min(ageError, Math.abs(width - ageError)) : ageError,
          );
          for (const [axis, key] of ['x', 'y', 'z'].entries())
            maxPosition = Math.max(
              maxPosition,
              Math.abs(e.positions[i * 3 + axis]! - frame.positions[i]![key as 'x']),
            );
        }
        const actual = Array.from({ length: child.count }, (_, i) => [
          ...child.positions.subarray(i * 3, i * 3 + 3),
        ]).sort((a, b) => a[0]! - b[0]!);
        const expected = [...frame.deathPositions].sort((a, b) => a.x - b.x);
        for (let i = 0; i < child.count; i++)
          for (const [axis, key] of ['x', 'y', 'z'].entries())
            maxDeathPosition = Math.max(
              maxDeathPosition,
              Math.abs(actual[i]![axis]! - expected[i]![key as 'x']),
            );
      }
    } finally {
      pack.dispose();
    }
  }
  expect(maxAge).toBeLessThan(2e-5);
  expect(maxPosition).toBeLessThan(1e-4);
  expect(maxDeathPosition).toBeLessThan(1e-4);
  recordError('ring-buffer-age', maxAge, 'second', '24 cases × 8 snapshots');
  recordError('ring-buffer-position', maxPosition, 'scene-unit', '24 cases × 8 snapshots');
  recordError(
    'ring-buffer-retired-death-position',
    maxDeathPosition,
    'scene-unit',
    '24 cases × 8 snapshots',
  );
});
const playback = JSON.parse(readNativeFixture('unity-particle-ring-playback.json')) as {
  cases: {
    mode: number;
    range: { x: number; y: number };
    frames: {
      frame: number;
      count: number;
      time: number;
      ages: number[];
      deathParticles: number;
    }[];
  }[];
};
it('matches actual Play ring counts, ages and delayed Death bursts at replacement boundaries', () => {
  let maxAge = 0;
  for (const c of playback.cases) {
    const { pack, e, child, graph, emit } = setup(c.mode, c.range, 0.1);
    e.enableLifetimeProgress();
    child.enableLifetimeProgress();
    try {
      for (const frame of c.frames) {
        if (frame.frame) graph.step(1 / 60);
        if (frame.frame === 0) emit(3);
        if (frame.frame === 10 || frame.frame === 15) emit(1);
        if (frame.frame === 20) emit(2);
        expect(e.count, `mode ${c.mode} frame ${frame.frame}`).toBe(frame.count);
        expect(child.count, `death mode ${c.mode} range ${c.range.y} frame ${frame.frame}`).toBe(
          frame.deathParticles,
        );
        for (let i = 0; i < e.count; i++) {
          const diff = Math.abs(e.ages[i]! - frame.ages[i]!);
          const width = (c.range.y - c.range.x) * 0.1;
          maxAge = Math.max(
            maxAge,
            c.mode === 2 && width > 0 ? Math.min(diff, Math.abs(width - diff)) : diff,
          );
        }
      }
    } finally {
      pack.dispose();
    }
  }
  expect(maxAge).toBeLessThan(2e-6);
  recordError('ring-buffer-play-age', maxAge, 'second', '9 cases × 30 frames');
});

it('processes bursts larger than the visible ring and clears retired pools on restart', () => {
  const { pack, e, child, graph, emit } = setup(2, { x: 0, y: 1 });
  try {
    emit(20);
    expect(e.count).toBe(3);
    expect([...e.serials.subarray(0, 3)]).toEqual([18, 19, 17]);
    graph.step(0.5);
    expect(child.count).toBe(0);
    e.reset();
    child.clear();
    e.sync();
    graph.step(0.6);
    expect(child.count).toBe(0);
    emit(4);
    expect([...e.serials.subarray(0, 3)]).toEqual([3, 1, 2]);
    graph.step(1.1);
    expect(child.count).toBe(1);
    e.clear();
    child.clear();
    graph.step(1);
    expect(child.count).toBe(0);
  } finally {
    pack.dispose();
  }
});
