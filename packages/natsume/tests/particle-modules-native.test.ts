import { expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { Scene } from '../src/runtime/scene.js';
import { Emitter } from '../src/runtime/emitter.js';
import * as I from '../src/format/generated/noa/ir.js';
import { archive } from './helpers.js';
import { constant, linear, vector, particleSource, manualParticle } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

type V = { x: number; y: number; z: number };
interface Case {
  kind: string;
  mode: number;
  combo: number;
  local: boolean;
  rotated: boolean;
  rotation: V & { w: number };
  scale: V;
  dt: number;
  speed: number;
  range: { x: number; y: number };
  samples: {
    frame: number;
    count: number;
    position: V;
    velocity: V;
    totalVelocity: V;
    color: { r: number; g: number; b: number; a: number };
    lifetime: number;
    remaining: number;
  }[];
}
const native: { cases: Case[] } = JSON.parse(readNativeFixture('unity-particle-modules.json'));

it('matches Unity force integration and speed color including collapsed ranges', async () => {
  const pack = await loadPack(await archive());
  const maxima: Record<string, number> = {};
  try {
    for (const row of native.cases.filter((r) => r.kind === 'force' || r.kind === 'color')) {
      const source = particleSource();
      source.main!.space = row.local ? I.Space.Local : I.Space.World;
      source.main!.lifetime = constant(4);
      if (row.kind === 'force') {
        const f = new I.ForceModuleT(vector());
        f.space = row.mode < 2 ? I.Space.Local : I.Space.World;
        f.force!.x = row.mode % 2 ? linear(0.4, 2.4) : constant(1.2);
        f.force!.y = row.mode % 2 ? linear(-1, 2) : constant(-0.7);
        f.force!.z = constant(0.3);
        source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.ForceModule, f));
      } else {
        const c = new I.ColorParameterT();
        c.mode = I.ColorMode.Gradient;
        c.gradientMax = new I.GradientT(
          I.GradientMode.Blend,
          [new I.RgbKeyT(0, 0.2, 0.4, 1.6), new I.RgbKeyT(1, 1.4, 0.8, 0.1)],
          [new I.AlphaKeyT(0, 0.25), new I.AlphaKeyT(1, 0.9)],
        );
        source.modules.push(
          new I.ParticleModuleT(
            I.ParticleModuleData.ColorBySpeedModule,
            new I.ColorBySpeedModuleT(c, new I.Vec2T(row.range.x, row.range.y)),
          ),
        );
      }
      if (row.combo)
        source.modules.push(
          new I.ParticleModuleT(
            I.ParticleModuleData.VelocityModule,
            new I.VelocityModuleT(
              vector(0.6, -0.3),
              vector(),
              vector(),
              constant(0),
              constant(1.3),
            ),
          ),
        );
      const scene = new Scene(pack, [1]);
      Object.assign(scene.nodes.get(1)!.localRotation, row.rotation);
      Object.assign(scene.nodes.get(1)!.localScale, row.scale);
      scene.nodes.get(1)!.transformDirty = true;
      scene.update();
      const e = new Emitter(5, scene.nodes.get(1)!, source, true, 12345, []);
      manualParticle(e);
      e.lifetimes[0] = 4;
      e.positions.set([0.2, -0.1, 0.3]);
      e.velocities.set([row.speed * 0.6, row.speed * 0.8, 0]);
      e.renderVelocities?.set(e.velocities.subarray(0, 3));
      if (e.moduleSpeeds) e.moduleSpeeds[0] = row.speed;
      e.startColors.fill(1, 0, 4);
      const colors = new Float32Array(4);
      for (let frame = 0; frame <= 12; frame++) {
        if (frame) e.step(row.dt);
        const sample = row.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        expect(e.count).toBe(sample.count);
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          for (const [name, actual, expected] of [
            ['position', e.positions[axis]!, sample.position[key]],
            ['velocity', e.velocities[axis]!, sample.velocity[key]],
          ] as const) {
            const error = Math.abs(actual - expected);
            if (row.kind === 'force')
              expect(
                error,
                JSON.stringify({
                  local: row.local,
                  rotation: row.rotated,
                  scale: row.scale,
                  mode: row.mode,
                  combo: row.combo,
                  frame,
                  name,
                  key,
                  actual,
                  expected,
                }),
              ).toBeLessThan(0.00002);
            maxima[row.kind + '.' + name] = Math.max(maxima[row.kind + '.' + name] ?? 0, error);
            recordError(
              'particle.' + row.kind + '.' + name,
              error,
              'units',
              `${row.mode}/${row.local}/${row.rotated}/${row.combo}/${frame}/${key}`,
            );
          }
        }
        e.sampleColor(0, colors);
        if (row.kind === 'color')
          for (const [channel, key] of (['r', 'g', 'b', 'a'] as const).entries()) {
            const error = Math.abs(colors[channel]! - sample.color[key]);
            maxima.color = Math.max(maxima.color ?? 0, error);
            recordError(
              'particle.color-by-speed',
              error,
              'channel',
              `${row.speed}/${frame}/${key}`,
            );
          }
      }
    }
    expect(Math.max(maxima['force.position'] ?? 0, maxima['force.velocity'] ?? 0)).toBeLessThan(
      0.00002,
    );
    expect(maxima.color ?? 0).toBeLessThan(2 / 255);
  } finally {
    pack.dispose();
  }
});

it('matches native lifetime-by-emitter-speed and Initial/Current inheritance', async () => {
  const pack = await loadPack(await archive());
  try {
    for (const row of native.cases.filter((r) => r.kind === 'lifetime' || r.kind === 'inherit')) {
      const source = particleSource();
      source.main!.space = row.local ? I.Space.Local : I.Space.World;
      source.main!.lifetime = constant(4);
      source.main!.emitterVelocityMode = I.EmitterVelocityMode.Custom;
      source.main!.customEmitterVelocity = new I.Vec3T(row.speed * 0.6, row.speed * 0.8, 0);
      source.modules.push(
        new I.ParticleModuleT(
          I.ParticleModuleData.EmissionModule,
          new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1))]),
        ),
      );
      if (row.kind === 'lifetime')
        source.modules.push(
          new I.ParticleModuleT(
            I.ParticleModuleData.LifetimeByEmitterSpeedModule,
            new I.LifetimeByEmitterSpeedModuleT(
              row.mode ? linear(0.4, 2.4) : constant(1.5),
              new I.Vec2T(row.range.x, row.range.y),
            ),
          ),
        );
      else
        source.modules.push(
          new I.ParticleModuleT(
            I.ParticleModuleData.InheritVelocityModule,
            new I.InheritVelocityModuleT(row.mode, row.combo ? linear(0.2, 1.2) : constant(0.7)),
          ),
        );
      const scene = new Scene(pack, [1]);
      Object.assign(scene.nodes.get(1)!.localRotation, row.rotation);
      Object.assign(scene.nodes.get(1)!.localScale, row.scale);
      scene.nodes.get(1)!.transformDirty = true;
      scene.update();
      const e = new Emitter(5, scene.nodes.get(1)!, source, true, 12345, []);
      e.sync();
      e.emitting = false;
      for (let frame = 0; frame <= 12; frame++) {
        if (frame) {
          source.main!.customEmitterVelocity!.x = row.speed * 0.6 * (frame <= 6 ? 1 : -0.5);
          source.main!.customEmitterVelocity!.y = row.speed * 0.8 * (frame <= 6 ? 1 : -0.5);
          e.step(row.dt);
        }
        const sample = row.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        expect(e.count).toBe(sample.count);
        const error = Math.abs(e.lifetimes[0]! - sample.lifetime);
        recordError(
          'particle.lifetime-by-emitter-speed',
          error,
          'seconds',
          `${row.mode}/${row.speed}/${row.range.x}/${row.range.y}`,
        );
        expect(error).toBeLessThan(0.00002);
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          for (const [name, actual, expected] of [
            ['position', e.positions[axis]!, sample.position[key]],
            ['velocity', e.velocities[axis]!, sample.velocity[key]],
            [
              'total-velocity',
              (e.renderVelocities ?? e.velocities)[axis]!,
              sample.totalVelocity[key],
            ],
          ] as const) {
            const error = Math.abs(actual - expected);
            recordError(
              'particle.inherit.' + name,
              error,
              'units',
              `${row.mode}/${row.local}/${row.combo}/${frame}/${key}`,
            );
            expect(
              error,
              `${row.kind}/${row.mode}/${row.combo}/${row.local}/${frame}/${name}/${key}: ${actual} vs ${expected}`,
            ).toBeLessThan(0.00002);
          }
        }
      }
    }
  } finally {
    pack.dispose();
  }
});

it('matches native independent-axis random force moments and per-frame variance', async () => {
  const data: {
    random: {
      perFrame: boolean;
      curves: boolean;
      dt: number;
      samples: { frame: number; mean: V; variance: V; covariance: V }[];
    }[];
  } = JSON.parse(readNativeFixture('unity-particle-modules.json'));
  const pack = await loadPack(await archive());
  try {
    for (const row of data.random ?? []) {
      const source = particleSource();
      source.main!.maxParticles = 4096;
      const f = new I.ForceModuleT(vector());
      f.randomizePerFrame = row.perFrame;
      const endpoints = [
        [0.2, 1.8, 0.6, 2.4],
        [-0.5, 2.5, 0.1, 3.5],
        [0.4, 1.2, 0.5, 1.7],
      ];
      for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
        const [a, b, c, d] = endpoints[axis]!;
        const p = constant(0);
        p.mode = row.curves ? I.ScalarMode.TwoCurves : I.ScalarMode.TwoConstants;
        p.constantMin = a!;
        p.constantMax = b!;
        if (row.curves) {
          p.curveMin = linear(a!, c!).curveMax;
          p.curveMax = linear(b!, d!).curveMax;
        }
        f.force![key] = p;
      }
      source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.ForceModule, f));
      const e = new Emitter(5, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
      e.sync();
      e.emitting = false;
      e.count = 4096;
      e.lifetimes.fill(4);
      for (let i = 0; i < e.count; i++) e.serials[i] = i;
      for (let frame = 1; frame <= 12; frame++) {
        e.step(row.dt);
        const sample = row.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        const mean = [0, 0, 0],
          square = [0, 0, 0],
          cross = [0, 0, 0];
        for (let i = 0; i < e.count; i++)
          for (let a = 0; a < 3; a++) {
            const v = e.velocities[i * 3 + a]!;
            mean[a]! += v / e.count;
            square[a]! += (v * v) / e.count;
            cross[a]! += (v * e.velocities[i * 3 + ((a + 1) % 3)]!) / e.count;
          }
        const variance = square.map((v, a) => v - mean[a]! ** 2);
        for (const [a, key] of (['x', 'y', 'z'] as const).entries()) {
          const meanError =
            Math.abs(mean[a]! - sample.mean[key]) / Math.max(1e-9, Math.abs(sample.mean[key]));
          const varianceError =
            Math.abs(variance[a]! - sample.variance[key]) / Math.max(1e-12, sample.variance[key]);
          const covariance = cross[a]! - mean[a]! * mean[(a + 1) % 3]!;
          const covarianceError =
            Math.abs(covariance - sample.covariance[key]) /
            Math.sqrt(variance[a]! * variance[(a + 1) % 3]!);
          for (const [metric, error] of [
            ['mean-relative', meanError],
            ['variance-relative', varianceError],
            ['covariance-normalized', covarianceError],
          ] as const) {
            recordError(
              'particle.force.random.' + metric,
              error,
              'ratio',
              `${row.perFrame}/${row.curves}/${frame}/${key}`,
            );
            expect(error).toBeLessThan(0.1);
          }
        }
      }
    }
  } finally {
    pack.dispose();
  }
});
