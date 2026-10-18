import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { particleSource, constant, linear, vector } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { RotationModuleT } from '../src/format/generated/noa/ir/rotation-module.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';

interface NativeCase {
  label: string;
  speed: number;
  duration: number;
  lifetime: number;
  rate: number;
  dt?: number;
  lifetimeCurve: boolean;
  samples: {
    frame: number;
    count: number;
    rotations: { x: number; y: number; z: number }[];
    remaining: number[];
    lifetimes: number[];
    seeds: number[];
  }[];
}
const native: { cases: NativeCase[] } = JSON.parse(
  readNativeFixture('unity-rotation-prewarm.json'),
);
for (const c of native.cases.filter(
  (c) => c.label !== 'prewarm' && !c.label.startsWith('prewarm-direct-boundary-'),
))
  it((c.lifetimeCurve ? 'measures Unity ' : 'matches Unity ') + c.label, async () => {
    const pack = await loadPack(await archive());
    const source = particleSource();
    const main = source.main!;
    main.rotation3d = true;
    main.rotation = vector((10 * Math.PI) / 180, (20 * Math.PI) / 180, (30 * Math.PI) / 180);
    main.durationSeconds = c.duration;
    main.maxParticles = 100;
    main.simulationSpeed = c.speed;
    const warm = c.label.startsWith('prewarm');
    main.loop = main.prewarm = warm;
    const life = c.lifetime;
    main.lifetime = c.lifetimeCurve ? linear(life / 2, life) : constant(life);
    if (warm)
      source.modules.push(
        new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(c.rate))),
      );
    else {
      const v = vector(c.label === 'rotation-xyz' ? 1 : 0, c.label === 'rotation-xyz' ? -2 : 0, 3);
      if (c.label === 'rotation-curve') v.z = linear(0, 2);
      source.modules.push(
        new ParticleModuleT(M.RotationModule, new RotationModuleT(v, c.label === 'rotation-xyz')),
      );
    }
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
    e.sync();
    if (!warm) {
      e.count = 1;
      e.emitting = false;
      e.lifetimes[0] = life;
      e.rotations.set([10, 20, 30].map((v) => (v * Math.PI) / 180));
    }
    const initialCount = e.count;
    for (let frame = 0; frame <= 60; frame++) {
      if (frame) e.step(c.dt ?? 1 / 60);
      const sample = c.samples.find((s) => s.frame === frame);
      if (!sample) continue;
      if (warm) {
        recordError(
          c.label.includes('window')
            ? 'prewarm.window.count'
            : c.lifetimeCurve
              ? 'prewarm.curve.count'
              : 'prewarm.count',
          e.count - sample.count,
          'particles',
          c.label + '/' + frame,
        );
        expect(Math.abs(e.count - sample.count)).toBeLessThanOrEqual(1);
        if (main.simulationSpeed === 0) {
          expect(e.count).toBe(0);
          continue;
        }
        const remaining = Array.from(
          e.ages.slice(0, e.count),
          (age, i) => e.lifetimes[i]! - age,
        ).sort((a, b) => a - b);
        expect(remaining.every((v) => v > 0 && v <= life)).toBe(true);
        // Native compacts expired particles; compare sorted remaining lifetimes.
        const expected = [...sample.remaining].sort((a, b) => a - b);
        const median = (a: number[]) => a[Math.floor(a.length / 2)]!;
        recordError(
          c.label.includes('window')
            ? 'prewarm.window.medianLifetime'
            : c.lifetimeCurve
              ? 'prewarm.curve.medianLifetime'
              : 'prewarm.medianLifetime',
          median(remaining) - median(expected),
          's',
          c.label + '/' + frame,
        );
        // A zero-lifetime boundary particle can shift the median by one birth spacing.
        const tolerance = remaining.length === expected.length ? 5e-5 : c.lifetime * 0.1;
        const alive = remaining.filter((v) => v > 2e-5);
        const nativeAlive = expected.filter((v) => v > 2e-5);
        expect(alive.length).toBe(nativeAlive.length);
        for (let i = 0; i < alive.length; i++) {
          const error = alive[i]! - nativeAlive[i]!;
          recordError('prewarm.alive.remainingLifetime', error, 's', `${c.label}/${frame}/${i}`);
          expect(Math.abs(error)).toBeLessThan(c.lifetimeCurve ? c.lifetime * 0.02 : 5e-5);
        }
        expect(Math.abs(median(remaining) - median(expected))).toBeLessThan(tolerance);
      } else
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          recordError(
            'rotation.angle',
            e.rotations[axis]! - (sample.rotations[0]![key] * Math.PI) / 180,
            'rad',
            c.label + '/' + frame + '/' + key,
          );
          expect(
            Math.abs(e.rotations[axis]! - (sample.rotations[0]![key] * Math.PI) / 180),
          ).toBeLessThan(main.simulationSpeed > 1 ? 2e-5 : 1e-5);
        }
    }
    if (warm) {
      e.reset();
      e.sync();
      expect(e.count).toBe(initialCount);
    }
    pack.dispose();
  });

it('bounds prewarm work and includes bounded curve-lifetime peaks', async () => {
  const pack = await loadPack(await archive());
  const node = new Scene(pack, [1]).nodes.get(1)!;
  const s = particleSource();
  s.main!.loop = s.main!.prewarm = true;
  s.main!.lifetime = constant(601);
  expect(() => new Emitter(3, node, s, true, 1, [])).toThrow('budget');
  s.main!.lifetime = linear(1, 2);
  expect(new Emitter(3, node, s, true, 1, []).prewarmSeconds).toBe(5);
  s.main!.lifetime = constant(35);
  expect(new Emitter(3, node, s, true, 1, []).prewarmSeconds).toBe(35);
  pack.dispose();
});

for (const c of native.cases.filter((c) => c.label.startsWith('prewarm-direct-boundary-')))
  it('matches native newborn frames and initial lifetimes ' + c.label, async () => {
    const pack = await loadPack(await archive());
    const source = particleSource();
    const main = source.main!;
    main.loop = main.prewarm = true;
    main.durationSeconds = c.duration;
    main.maxParticles = 100;
    main.simulationSpeed = c.speed;
    main.lifetime = linear(c.lifetime / 2, c.lifetime);
    source.modules.push(
      new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(c.rate))),
    );
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
    e.sync();
    let knownSerials = new Set(e.serials.slice(0, e.count));
    let knownSeeds = new Set(c.samples[0]!.seeds);
    for (const sample of c.samples.slice(1)) {
      e.step(c.dt ?? 1 / 60);
      const actual = Array.from({ length: e.count }, (_, i) => i)
        .filter((i) => !knownSerials.has(e.serials[i]!))
        .map((i) => ({ life: e.lifetimes[i]!, age: e.ages[i]! }))
        .sort((a, b) => b.age - a.age);
      const expected = sample.seeds
        .flatMap((seed, i) =>
          knownSeeds.has(seed)
            ? []
            : [{ life: sample.lifetimes[i]!, age: sample.lifetimes[i]! - sample.remaining[i]! }],
        )
        .sort((a, b) => b.age - a.age);
      const label = `${c.label}/${sample.frame}`;
      // Retained prewarm particles can already differ by one 0.02 s birth step.
      // Measure that residual separately from the live newborn boundary regression.
      recordError('prewarm.boundary.count', e.count - sample.count, 'particles', label);
      expect(Math.abs(e.count - sample.count)).toBeLessThanOrEqual(1);
      if (e.count === sample.count) {
        const remaining = Array.from(
          e.ages.slice(0, e.count),
          (age, i) => e.lifetimes[i]! - age,
        ).sort((a, b) => a - b);
        const nativeRemaining = [...sample.remaining].sort((a, b) => a - b);
        for (let i = 0; i < remaining.length; i++) {
          const error = remaining[i]! - nativeRemaining[i]!;
          recordError('prewarm.boundary.remainingLifetime', error, 's', `${label}/${i}`);
          expect(Math.abs(error)).toBeLessThan(c.lifetime * 0.02);
        }
      }
      recordError('prewarm.birth.count', actual.length - expected.length, 'particles', label);
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i++) {
        const lifeError = actual[i]!.life - expected[i]!.life;
        const ageError = actual[i]!.age - expected[i]!.age;
        recordError('prewarm.birth.lifetime', lifeError, 's', `${label}/${i}`);
        recordError('prewarm.birth.age', ageError, 's', `${label}/${i}`);
        expect(Math.abs(lifeError)).toBeLessThan(2e-5);
        expect(Math.abs(ageError)).toBeLessThan(2e-5);
      }
      knownSerials = new Set(e.serials.slice(0, e.count));
      knownSeeds = new Set(sample.seeds);
    }
    pack.dispose();
  });
