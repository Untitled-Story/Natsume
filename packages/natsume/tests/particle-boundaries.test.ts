import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { Scene } from '../src/runtime/scene.js';
import { Emitter } from '../src/runtime/emitter.js';
import { archive, encode, minimalDocument } from './helpers.js';
import { particleSource, manualParticle, constant, linear } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { TextureSheetModuleT } from '../src/format/generated/noa/ir/texture-sheet-module.js';
import { sheetFrame, color, scalar } from '../src/runtime/parameters.js';
import type { SizeModuleT } from '../src/format/generated/noa/ir/size-module.js';
import type { ColorModuleT } from '../src/format/generated/noa/ir/color-module.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { ColorContextT } from '../src/format/generated/noa/ir/color-context.js';
import { FeatureRequirementT } from '../src/format/generated/noa/ir/feature-requirement.js';

interface NativeSample {
  frame: number;
  count: number;
  positions: { x: number; y: number; z: number }[];
  velocities: { x: number; y: number; z: number }[];
  sizes: { x: number; y: number; z: number }[];
  colors: { r: number; g: number; b: number; a: number }[];
  uv: { x: number; y: number }[];
}
const native: { cases: { label: string; samples: NativeSample[] }[] } = JSON.parse(
  readFileSync(new URL('./fixtures/unity-boundaries.json', import.meta.url), 'utf8'),
);
let scene: Scene;
beforeAll(async () => {
  scene = new Scene(await loadPack(await archive()), [1]);
});

it('holds emission during the authored start delay', () => {
  const source = particleSource();
  source.main!.startDelay = constant(0.2);
  source.modules.push(new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(60))));
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  emitter.sync();
  for (let i = 0; i < 12; i++) {
    emitter.step(1 / 60);
    expect(emitter.count).toBe(0);
  }
  emitter.step(1 / 60);
  expect(emitter.count).toBeGreaterThan(0);
});

it('applies host gravity through the authored multiplier', () => {
  const source = particleSource();
  source.main!.gravityMultiplier = constant(1);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, [], [0, -10, 0]);
  emitter.sync();
  expect(emitter.gravity).toEqual([0, -10, 0]);
  expect(emitter.main.gravityMultiplier?.constantMax).toBe(1);
  expect(emitter.count).toBe(1);
  emitter.step(1 / 60);
  emitter.step(1 / 60);
  expect(emitter.velocities[1]).toBe(0);
  expect(emitter.positions[1]).toBeCloseTo((-10 / 60) * (1 / 60) * 2, 6);
});

for (const label of ['burst-zero', 'burst-loop', 'burst-end']) {
  it(`matches native ${label} counts at fixed-step boundaries`, () => {
    const source = particleSource();
    source.main!.durationSeconds = Math.fround(0.1);
    source.main!.loop = label === 'burst-loop' || label === 'burst-end';
    const burst =
      label === 'burst-repeat'
        ? new BurstT(Math.fround(0.025), constant(2), 4, Math.fround(0.02))
        : new BurstT(label === 'burst-end' ? Math.fround(0.1) : 0, constant(3));
    source.modules.push(
      new ParticleModuleT(M.EmissionModule, new EmissionModuleT(null, null, [burst])),
    );
    const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    emitter.sync();
    const fixture = native.cases.find((c) => c.label === label)!;
    // Natsume intentionally exposes the zero-time burst immediately on play.
    for (let frame = 1; frame <= 18; frame++) {
      emitter.step(1 / 60);
      expect(emitter.count).toBe(fixture.samples.find((s) => s.frame === frame)!.count);
    }
  });
}

for (const label of [
  'burst-infinite',
  'burst-infinite-loop',
  'burst-infinite-delayed',
  'burst-finite-zero-interval',
]) {
  it('loads and matches native ' + label + ' across cycle boundaries', async () => {
    const source = particleSource();
    source.main!.durationSeconds = Math.fround(label.includes('zero-interval') ? 0.1 : 0.2);
    source.main!.color = new ColorParameterT();
    source.main!.color.colorMax = new ColorT(1, 1, 1, 1);
    source.main!.loop = label.endsWith('-loop');
    source.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(null, null, [
          new BurstT(
            label.endsWith('-delayed') ? Math.fround(0.025) : 0,
            constant(2),
            label.includes('finite-zero') ? 3 : 0,
            label.includes('zero-interval') ? 0 : Math.fround(0.05),
          ),
        ]),
      ),
    );
    const document = minimalDocument();
    document.colorContext = new ColorContextT(1);
    document.features = [new FeatureRequirementT('color.authored', 1, true)];
    document.components = [new ComponentT(3, 1, true, ComponentData.ParticleSystem, source)];
    const pack = await loadPack(await archive(encode(document)));
    pack.dispose();
    const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    emitter.sync();
    const fixture = native.cases.find((c) => c.label === label)!;
    for (let frame = 1; frame <= 18; frame++) {
      emitter.step(1 / 60);
      expect(emitter.count).toBe(fixture.samples.find((s) => s.frame === frame)!.count);
    }
  });
}

it('rejects unbounded burst work and infinite bursts without a positive interval', () => {
  const source = particleSource();
  const burst = new BurstT(0, constant(1), 0, 0);
  source.modules.push(
    new ParticleModuleT(M.EmissionModule, new EmissionModuleT(null, null, [burst])),
  );
  const create = () => new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  expect(create).toThrow(/positive repeat interval/);
  burst.intervalSeconds = 1e-12;
  expect(create).toThrow(/Too many burst repetitions/);
});

it('keeps short repeated bursts bounded without copying native early cutoff', () => {
  const source = particleSource();
  source.main!.durationSeconds = Math.fround(0.1);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(null, null, [
        new BurstT(Math.fround(0.025), constant(2), 4, Math.fround(0.02)),
      ]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  emitter.sync();
  const fixture = native.cases.find((c) => c.label === 'burst-repeat')!;
  for (let frame = 1; frame <= 18; frame++) {
    emitter.step(1 / 60);
    const count = fixture.samples.find((s) => s.frame === frame)!.count;
    // Measured native short-duration cutoff drops the last two-particle burst.
    expect(Math.abs(emitter.count - count)).toBeLessThanOrEqual(2);
  }
  expect(emitter.count).toBe(8);
});

it('keeps burst boundaries single, includes duration-end and resets loop curve phase', () => {
  const source = particleSource();
  source.main!.durationSeconds = 0.1;
  source.main!.loop = true;
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), null, [
        new BurstT(0, linear(1, 3)),
        new BurstT(0.1, constant(2)),
      ]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  emitter.sync();
  expect(emitter.count).toBe(1);
  for (let i = 0; i < 6; i++) emitter.step(1 / 60);
  expect(emitter.count).toBe(3);
  emitter.step(1 / 60);
  expect(emitter.count).toBe(4);
  for (let i = 0; i < 5; i++) emitter.step(1 / 60);
  expect(emitter.count).toBe(6);
  emitter.step(1 / 60);
  expect(emitter.count).toBe(7);
});

it('expires short-lived particles without a terminal frame or a repeat burst', () => {
  const source = particleSource();
  source.main!.lifetime = constant(0.05);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  emitter.sync();
  for (let i = 0; i < 2; i++) emitter.step(1 / 60);
  expect(emitter.count).toBe(1);
  emitter.step(1 / 60);
  expect(emitter.count).toBe(0);
  emitter.step(1 / 60);
  expect(emitter.count).toBe(0);
});

it('handles zero speed multiplier and radial origin without NaN', () => {
  const source = particleSource('motion-limit-combined');
  const v = source.modules.find((m) => m.dataType === M.VelocityModule)!
    .data as import('../src/format/generated/noa/ir/velocity-module.js').VelocityModuleT;
  v.speedMultiplier = constant(0);
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  manualParticle(emitter);
  emitter.positions.fill(0);
  for (let i = 0; i < 10; i++) emitter.step(1 / 60);
  expect(Array.from(emitter.positions.slice(0, 3))).toEqual([0, 0, 0]);
  expect(Array.from(emitter.velocities.slice(0, 3)).every(Number.isFinite)).toBe(true);
});

it('retains combined render velocity through deaths and new births', () => {
  const source = particleSource('motion-linear');
  source.main!.lifetime = constant(0.1);
  source.modules.push(new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(60))));
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
  emitter.renderVelocities = emitter.velocities.slice();
  emitter.sync();
  for (let frame = 0; frame < 24; frame++) {
    emitter.step(1 / 60);
    for (let i = 0; i < emitter.count; i++) {
      const velocity = Array.from(emitter.renderVelocities.subarray(i * 3, i * 3 + 3));
      // Newborns have only initial speed; surviving particles have module velocity.
      expect(velocity).toEqual(emitter.ages[i] === 0 ? [0, 0, 0] : [1, 2, 3]);
    }
  }
});

it('wraps sheet time before curve evaluation, clamps endpoints and keeps the terminal tile', () => {
  const sheet = new TextureSheetModuleT();
  sheet.columns = 4;
  sheet.rows = 2;
  sheet.cycles = 2;
  sheet.frameOverTime = constant(0.25);
  sheet.startFrame = constant(0);
  expect(sheetFrame(sheet, 0.3, 0, 0)).toBe(2);
  sheet.frameOverTime = linear(0, 1);
  expect(sheetFrame(sheet, 0.5, 0, 0)).toBe(0);
  expect(sheetFrame(sheet, 1, 0, 0)).toBe(7);
  sheet.frameOverTime = constant(1);
  expect(sheetFrame(sheet, 0, 0, 0)).toBe(7);
  sheet.startFrame = constant(2);
  sheet.frameOverTime = constant(0);
  expect(sheetFrame(sheet, 0, 0, 0)).toBe(7);
  sheet.startFrame = constant(0);
  sheet.frameOverTime = linear(0, 1);
  sheet.frameOverTime.curveMax!.keys[0]!.interpolation = 2;
  sheet.frameOverTime.curveMax!.keys[1]!.inSlope = 2;
  expect(sheetFrame(sheet, 0.4, 0, 0)).toBe(5);
});

for (const fixture of native.cases.filter((c) => /appearance-(blend|fixed)$/.test(c.label))) {
  it(`matches native ${fixture.label} size and color within Color32 precision`, () => {
    const source = particleSource(fixture.label);
    const size = source.modules.find((m) => m.dataType === M.SizeModule)!.data as SizeModuleT;
    const c = source.modules.find((m) => m.dataType === M.ColorModule)!.data as ColorModuleT;
    const rgba = new Float32Array(4);
    for (const sample of fixture.samples) {
      const t = sample.frame / 60;
      color(c.color, t, 0, rgba);
      for (const [index, axis] of ['x', 'y', 'z'].entries()) {
        const key = axis as 'x' | 'y' | 'z';
        expect(scalar(size.size![key], t) * [2, 3, 4][index]!).toBeCloseTo(
          sample.sizes[0]![key],
          4,
        );
      }
      for (const [index, key] of (['r', 'g', 'b', 'a'] as const).entries()) {
        expect(
          Math.abs(rgba[index]! * [0.8, 0.6, 0.4, 128 / 255][index]! - sample.colors[0]![key]),
        ).toBeLessThanOrEqual(2 / 255);
      }
    }
  });
}

for (const fixture of native.cases.filter((c) => c.label.startsWith('motion-'))) {
  it(`matches native ${fixture.label} without Noise or random births`, () => {
    const emitter = new Emitter(
      3,
      scene.nodes.get(1)!,
      particleSource(fixture.label),
      true,
      12345,
      [],
    );
    manualParticle(emitter);
    for (let frame = 0; frame <= 59; frame++) {
      if (frame) emitter.step(1 / 60);
      const sample = fixture.samples.find((s) => s.frame === frame);
      if (!sample) continue;
      expect(emitter.count).toBe(1);
      for (const [index, axis] of ['x', 'y', 'z'].entries()) {
        const key = axis as 'x' | 'y' | 'z';
        expect(emitter.positions[index]!).toBeCloseTo(sample.positions[0]![key], 4);
        expect(emitter.velocities[index]!).toBeCloseTo(sample.velocities[0]![key], 4);
      }
    }
  });
}
