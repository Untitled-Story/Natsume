import { recordError } from './measurement.js';
import { readFileSync } from 'node:fs';
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
  samples: {
    frame: number;
    count: number;
    rotations: { x: number; y: number; z: number }[];
    remaining: number[];
  }[];
}
const native: { cases: NativeCase[] } = JSON.parse(
  readFileSync(new URL('./fixtures/unity-rotation-prewarm.json', import.meta.url), 'utf8'),
);
for (const c of native.cases.filter((c) => c.label !== 'prewarm'))
  it(
    (c.label === 'prewarm-direct-curve' ? 'measures Unity ' : 'matches Unity ') + c.label,
    async () => {
      const pack = await loadPack(await archive());
      const source = particleSource();
      const main = source.main!;
      main.rotation3d = true;
      main.rotation = vector((10 * Math.PI) / 180, (20 * Math.PI) / 180, (30 * Math.PI) / 180);
      main.durationSeconds = c.label.includes('duration3') ? 3 : 1;
      main.maxParticles = 100;
      main.simulationSpeed = c.speed;
      const warm = c.label.startsWith('prewarm');
      main.loop = main.prewarm = warm;
      const life =
        c.label.includes('long') || c.label.includes('life4') || c.label === 'rotation-speed-double'
          ? 4
          : c.label.includes('life1')
            ? 1
            : 2;
      main.lifetime = warm && c.label.endsWith('-curve') ? linear(1, 2) : constant(life);
      if (warm)
        source.modules.push(
          new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(10))),
        );
      else {
        const v = vector(
          c.label === 'rotation-xyz' ? 1 : 0,
          c.label === 'rotation-xyz' ? -2 : 0,
          3,
        );
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
      for (let frame = 0; frame <= 60; frame++) {
        if (frame) e.step(1 / 60);
        const sample = c.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        if (warm) {
          recordError(
            c.label === 'prewarm-direct-curve' ? 'prewarm.curve.count' : 'prewarm.count',
            e.count - sample.count,
            'particles',
            c.label + '/' + frame,
          );
          expect(Math.abs(e.count - sample.count)).toBeLessThanOrEqual(2);
          if (main.simulationSpeed === 0) {
            expect(e.count).toBe(0);
            continue;
          }
          const remaining = Array.from(
            e.ages.slice(0, e.count),
            (age, i) => e.lifetimes[i]! - age,
          ).sort((a, b) => a - b);
          expect(remaining.every((v) => v > 0 && v <= life)).toBe(true);
          // Native keeps a boundary birth pending; compare the median, not serial order.
          const expected = [...sample.remaining].sort((a, b) => a - b);
          const median = (a: number[]) => a[Math.floor(a.length / 2)]!;
          recordError(
            c.label === 'prewarm-direct-curve'
              ? 'prewarm.curve.medianLifetime'
              : 'prewarm.medianLifetime',
            median(remaining) - median(expected),
            's',
            c.label + '/' + frame,
          );
          if (c.label !== 'prewarm-direct-curve')
            expect(Math.abs(median(remaining) - median(expected))).toBeLessThan(0.12);
          else expect(Number.isFinite(median(remaining) - median(expected))).toBe(true);
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
        const before = e.count;
        e.reset();
        e.sync();
        expect(Math.abs(e.count - before)).toBeLessThanOrEqual(1);
      }
      pack.dispose();
    },
  );

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
