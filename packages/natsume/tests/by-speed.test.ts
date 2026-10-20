import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { particleSource, constant, linear, vector, manualParticle } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { SizeBySpeedModuleT } from '../src/format/generated/noa/ir/size-by-speed-module.js';
import { RotationBySpeedModuleT } from '../src/format/generated/noa/ir/rotation-by-speed-module.js';
import { RotationModuleT } from '../src/format/generated/noa/ir/rotation-module.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { LimitVelocityModuleT } from '../src/format/generated/noa/ir/limit-velocity-module.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { speedSize } from '../src/runtime/speed-modules.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

type V = { x: number; y: number; z: number };
interface Case {
  label: string;
  mode: number;
  combo: number;
  axes: boolean;
  holdout: boolean;
  speed: number;
  dt: number;
  range: { x: number; y: number };
  samples: { frame: number; size: V; rotation: V; velocity: V; totalVelocity: V; position: V }[];
}
const native: { cases: Case[] } = JSON.parse(readNativeFixture('unity-by-speed.json'));
const parameter = (mode: number, factor: number) =>
  mode === 0 ? constant(1.2 * factor) : linear(0.25 * factor, 1.75 * factor);
for (const holdout of [false, true])
  it('matches Unity speed modules ' + (holdout ? 'holdout' : 'primary'), async () => {
    const pack = await loadPack(await archive());
    const maxima: Record<string, number> = {};
    for (const c of native.cases.filter(
      (c) => c.mode < 2 && c.combo !== 6 && c.holdout === holdout,
    )) {
      const source = particleSource();
      source.main!.rotation3d = true;
      source.main!.size3d = true;
      source.main!.gravityMultiplier = constant(c.combo === 1 ? 0.5 : 0);
      const size = new SizeBySpeedModuleT(vector(), c.axes, new Vec2T(c.range.x, c.range.y));
      size.size!.x = parameter(c.mode, 1);
      size.size!.y = parameter(c.mode, 0.7);
      size.size!.z = parameter(c.mode, 1.3);
      const rotation = new RotationBySpeedModuleT(vector(), c.axes, size.speedRange);
      rotation.angularVelocity!.x = parameter(c.mode, 0.6);
      rotation.angularVelocity!.y = parameter(c.mode, -0.8);
      rotation.angularVelocity!.z = parameter(c.mode, 1.1);
      source.modules.push(
        new ParticleModuleT(M.SizeBySpeedModule, size),
        new ParticleModuleT(M.RotationBySpeedModule, rotation),
      );
      if (c.combo === 2 || c.combo === 5)
        source.modules.push(
          new ParticleModuleT(
            M.VelocityModule,
            new VelocityModuleT(vector(1, 2, -0.5), vector(), vector(), constant(0), constant(1.4)),
          ),
        );
      if (c.combo === 3 || c.combo === 5 || c.combo === 7) {
        const l = new LimitVelocityModuleT();
        l.limit = vector(c.combo === 7 ? 100 : 1.5);
        if (c.combo === 7) {
          l.drag = constant(0.3);
          l.multiplyDragBySize = true;
        }
        l.dampen = 0.3;
        source.modules.push(new ParticleModuleT(M.LimitVelocityModule, l));
      }
      if (c.combo === 4)
        source.modules.push(
          new ParticleModuleT(M.RotationModule, new RotationModuleT(vector(0, 0, 0.8))),
        );
      const e = new Emitter(
        3,
        new Scene(pack, [1]).nodes.get(1)!,
        source,
        true,
        12345,
        [],
        [0, -9.81, 0],
      );
      manualParticle(e);
      e.lifetimes[0] = 4;
      e.positions.set([0.2, -0.1, 0.3]);
      e.velocities.set([c.speed * 0.6, c.speed * 0.8, 0]);
      e.moduleSpeeds![0] = Math.hypot(...e.velocities.subarray(0, 3));
      e.rotations.set([10, 20, 30].map((v) => (v * Math.PI) / 180));
      for (let frame = 0; frame <= 12; frame++) {
        if (frame) e.step(c.dt);
        const sample = c.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        const speed: number = e.moduleSpeeds![0]!;
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          const lifetime = c.combo === 4 ? 0.7 + (0.6 * frame * c.dt) / 4 : 1;
          const actualSize: number =
            e.startSizes[axis]! * speedSize(size, speed, 0, axis) * lifetime;
          for (const [metric, actual, expected, unit] of [
            ['size', actualSize, sample.size[key], 'units'],
            ['rotation', e.rotations[axis]!, (sample.rotation[key] * Math.PI) / 180, 'rad'],
          ] as const) {
            const error = Math.abs(actual - expected);
            const group = c.combo + '/' + metric;
            maxima[group] = Math.max(maxima[group] ?? 0, error);
            recordError(
              'speed.' + metric + '.' + (holdout ? 'holdout' : 'primary'),
              error,
              unit,
              c.label + '/' + frame + '/' + key,
            );
          }
        }
      }
    }
    expect(Math.max(...Object.values(maxima))).toBeLessThan(0.001);
    pack.dispose();
  });

it('matches native random speed distributions and preserves per-particle factors', async () => {
  const pack = await loadPack(await archive());
  const { random } = await import('../src/runtime/parameters.js');
  const { ScalarMode } = await import('../src/format/generated/noa/ir/scalar-mode.js');
  const errors: number[] = [];
  for (const mode of [2, 3]) {
    const unity: number[] = [],
      runtime: number[] = [];
    for (const [index, c] of native.cases.entries()) {
      if (c.mode !== mode || c.combo >= 6) continue;
      const s = c.samples[0]!;
      const speed = Math.hypot(...Object.values(s.totalVelocity));
      const { speedPhase } = await import('../src/runtime/speed-modules.js');
      const u = speedPhase(speed, new Vec2T(c.range.x, c.range.y));
      const low = mode === 2 ? 0.4 : 0.1 + 0.7 * u,
        high = mode === 2 ? 1.6 : 0.25 + 1.5 * u;
      const lifetime = c.combo === 4 ? 0.7 : 1;
      unity.push((s.size.x / 2 / lifetime - low) / (high - low));
      const factor = random(12345, index, 73);
      runtime.push(factor);
      if (c.axes) {
        const y = (s.size.y / 3 / lifetime / 0.7 - low) / (high - low);
        expect(Math.abs(y - unity.at(-1)!)).toBeLessThan(1e-5);
      }
    }
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    const variance = (v: number[]) => mean(v.map((x) => (x - mean(v)) ** 2));
    for (const [metric, error] of [
      ['mean', mean(unity) - mean(runtime)],
      ['variance', variance(unity) - variance(runtime)],
    ] as const) {
      recordError('speed.random.' + metric, error, 'normalized', String(mode));
      errors.push(Math.abs(error));
    }
    expect(Math.abs(mean(unity) - 0.5)).toBeLessThan(0.05);
    for (const channel of [73, 74]) {
      const source = particleSource();
      const p = linear(0.25, 1.75);
      p.mode = mode === 2 ? ScalarMode.TwoConstants : ScalarMode.TwoCurves;
      p.constantMin = 0.4;
      p.constantMax = 1.6;
      p.curveMin = linear(0.1, 0.8).curveMax;
      const v = vector();
      v.x = v.y = v.z = p;
      source.modules.push(
        new ParticleModuleT(M.SizeBySpeedModule, new SizeBySpeedModuleT(v, true, new Vec2T(0, 3))),
        new ParticleModuleT(
          M.RotationBySpeedModule,
          new RotationBySpeedModuleT(v, true, new Vec2T(0, 3)),
        ),
      );
      const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
      manualParticle(e);
      e.lifetimes[0] = 4;
      const factor = random(e.seed, e.serials[0]!, channel);
      for (let frame = 0; frame < 5; frame++) {
        const before = e.rotations[0]!;
        e.step(1 / 60);
        const phase = 2 / 3;
        const expected =
          mode === 2
            ? 0.4 + 1.2 * factor
            : 0.1 + 0.7 * phase + (0.25 + 1.5 * phase - 0.1 - 0.7 * phase) * factor;
        if (channel === 73)
          expect(Math.abs(speedSize(e.sizeBySpeed!, 2, factor, 0) - expected)).toBeLessThan(1e-6);
        else expect(Math.abs((e.rotations[0]! - before) * 60 - expected)).toBeLessThan(1e-5);
      }
    }
  }
  expect(Math.max(...errors)).toBeLessThan(0.05);
  pack.dispose();
});

it('uses native total velocity before noise displacement for speed-driven sizes', () => {
  for (const c of native.cases.filter((c) => c.mode === 1 && c.combo === 6)) {
    const values = vector();
    values.x = linear(0.25, 1.75);
    values.y = linear(0.175, 1.225);
    values.z = linear(0.325, 2.275);
    const module = new SizeBySpeedModuleT(values, c.axes, new Vec2T(c.range.x, c.range.y));
    for (const s of c.samples)
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
        const expected =
          (axis + 2) * speedSize(module, Math.hypot(...Object.values(s.totalVelocity)), 0, axis);
        const error = expected - s.size[key];
        recordError('speed.noise.size', error, 'units', c.label + '/' + s.frame + '/' + key);
        expect(Math.abs(error)).toBeLessThan(0.0001);
      }
  }
});
