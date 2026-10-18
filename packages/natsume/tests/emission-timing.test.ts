import { expect, it } from 'vitest';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { minimalDocument } from './helpers.js';
import { constant, linear, particleSource } from './particle-fixtures.js';
import { Scene } from '../src/runtime/scene.js';
import { Emitter } from '../src/runtime/emitter.js';
import type { EffectPack } from '../src/pack.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';

interface NativeCase {
  label: string;
  stepSeconds: number;
  rate: number;
  lifetimeCurve: boolean;
  rateCurve: boolean;
  duration: number;
  samples: { frame: number; count: number; remaining: number[]; lifetimes: number[] }[];
}
const native = JSON.parse(readNativeFixture('unity-boundaries.json')) as { cases: NativeCase[] };
for (const c of native.cases.filter((c) => c.label.startsWith('rate-window-')))
  it('matches native within-step births ' + c.label, () => {
    const doc = minimalDocument();
    const pack = {
      nodes: doc.nodes,
      components: [],
      getNode: (id: number) => doc.nodes.find((n) => n.id === id),
    } as unknown as EffectPack;
    const source = particleSource();
    source.main!.durationSeconds = c.duration;
    source.main!.lifetime = c.lifetimeCurve
      ? linear(Math.fround(0.65), Math.fround(1.3))
      : constant(Math.fround(1.3));
    source.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(c.rateCurve ? linear(0, c.rate) : constant(c.rate)),
      ),
    );
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
    e.sync();
    for (const sample of c.samples) {
      if (sample.frame) {
        const count = Math.ceil(c.stepSeconds / Math.fround(0.03));
        for (let i = 0; i < count; i++) e.step(Math.fround(c.stepSeconds / count));
      }
      recordError(
        'emission.birth.count',
        e.count - sample.count,
        'particles',
        c.label + '/' + sample.frame,
      );
      expect(e.count).toBe(sample.count);
      const actual = Array.from({ length: e.count }, (_, i) => ({
        life: e.lifetimes[i]!,
        remaining: e.lifetimes[i]! - e.ages[i]!,
      })).sort((a, b) => a.remaining - b.remaining);
      const expected = sample.remaining
        .map((remaining, i) => ({ remaining, life: sample.lifetimes[i]! }))
        .sort((a, b) => a.remaining - b.remaining);
      for (let i = 0; i < e.count; i++) {
        const error = actual[i]!.remaining - expected[i]!.remaining;
        recordError(
          'emission.birth.remainingLifetime',
          error,
          's',
          c.label + '/' + sample.frame + '/' + i,
        );
        recordError(
          'emission.birth.lifetime',
          actual[i]!.life - expected[i]!.life,
          's',
          c.label + '/' + sample.frame + '/' + i,
        );
        expect(Math.abs(error)).toBeLessThan(0.00001);
        expect(actual[i]!.life).toBeCloseTo(expected[i]!.life, 5);
      }
    }
  });

it('bounds within-step work for short lives at a saturated emission rate', () => {
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const source = particleSource();
  source.main!.lifetime = constant(0.001);
  source.modules.push(new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(1e8))));
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 1, []);
  e.sync();
  e.step(1 / 60);
  expect(e.count).toBe(source.main!.maxParticles);
  expect(e.ages.subarray(0, e.count).every((age) => age >= 0 && age < 0.001)).toBe(true);
});
