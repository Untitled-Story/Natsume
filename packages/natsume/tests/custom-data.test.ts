import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import type { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, linear, manualParticle } from './particle-fixtures.js';
import { CustomDataStreamT } from '../src/format/generated/noa/ir/custom-data-stream.js';
import { CustomDataModuleT } from '../src/format/generated/noa/ir/custom-data-module.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { ColorMode } from '../src/format/generated/noa/ir/color-mode.js';
import { GradientT } from '../src/format/generated/noa/ir/gradient.js';
import { RgbKeyT } from '../src/format/generated/noa/ir/rgb-key.js';
import { AlphaKeyT } from '../src/format/generated/noa/ir/alpha-key.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
it('evaluates both custom streams with vector and authored HDR color values', () => {
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const source = particleSource();
  const color = new ColorParameterT();
  color.colorMax = new ColorT(2, -0.2, 0.4, 0.5);
  source.modules.push(
    new ParticleModuleT(
      M.CustomDataModule,
      new CustomDataModuleT([
        new CustomDataStreamT(0, 1, 4, [linear(0, 1), constant(2), constant(3), constant(4)]),
        new CustomDataStreamT(1, 2, 0, [], color),
      ]),
    ),
  );
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 1, []);
  manualParticle(e);
  e.step(0.25);
  // A 0.25 s call uses nine substeps; Custom Data samples the final substep start.
  expect(e.customData![0]).toBeCloseTo(2 / 9, 6);
  expect([...e.customData!.slice(1, 5)]).toEqual([2, 3, 4, 2]);
  expect(e.customData![5]).toBeCloseTo(-0.2, 6);
  expect(e.customData![7]).toBe(0.5);
});

const native = JSON.parse(readNativeFixture('unity-custom-data.json')) as {
  cases: {
    label: string;
    components: number;
    lifetime: number;
    steps: number[];
    emitted: boolean;
    gradient: boolean;
    samples: {
      frame: number;
      custom1: { x: number; y: number; z: number; w: number };
      custom2: { x: number; y: number; z: number; w: number };
    }[];
  }[];
};
for (const sample of native.cases)
  it('matches Unity custom streams ' + sample.label, () => {
    const doc = minimalDocument();
    const pack = {
      nodes: doc.nodes,
      components: [],
      getNode: (id: number) => doc.nodes.find((n) => n.id === id),
    } as unknown as EffectPack;
    const source = particleSource();
    const color = new ColorParameterT();
    color.colorMax = new ColorT(2, -0.2, 0.4, 0.5);
    source.main!.lifetime = constant(sample.lifetime);
    if (sample.gradient) {
      color.mode = ColorMode.Gradient;
      color.gradientMax = new GradientT(
        0,
        [new RgbKeyT(0, 1, 0, 0), new RgbKeyT(1, 0, 0, 1)],
        [new AlphaKeyT(0, 0.2), new AlphaKeyT(1, 0.8)],
      );
    }
    if (sample.emitted)
      source.modules.push(
        new ParticleModuleT(
          M.EmissionModule,
          new EmissionModuleT(null, null, [new BurstT(0, constant(1))]),
        ),
      );
    source.modules.push(
      new ParticleModuleT(
        M.CustomDataModule,
        new CustomDataModuleT([
          new CustomDataStreamT(
            0,
            1,
            sample.components,
            [linear(0, 1), constant(2), constant(3), constant(4)].slice(0, sample.components),
          ),
          new CustomDataStreamT(1, 2, 0, [], color),
        ]),
      ),
    );
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 1, []);
    if (sample.emitted) e.sync();
    else {
      manualParticle(e);
      e.lifetimes[0] = sample.lifetime;
    }
    for (let frame = 1; frame <= sample.steps.length; frame++) {
      const dt = sample.steps[frame - 1]!;
      e.step(dt);
      const expected = sample.samples.find((s) => s.frame === frame);
      if (!expected) continue;
      for (const [i, key] of (['x', 'y', 'z', 'w'] as const).entries()) {
        recordError(
          'custom.vector',
          e.customData![i]! - expected.custom1[key],
          'value',
          sample.label + '/' + frame + '/' + key,
        );
        recordError(
          'custom.color',
          e.customData![4 + i]! - expected.custom2[key],
          'HDR channel',
          sample.label + '/' + frame + '/' + key,
        );
        expect(Math.abs(e.customData![i]! - expected.custom1[key])).toBeLessThan(1e-6);
        expect(Math.abs(e.customData![4 + i]! - expected.custom2[key])).toBeLessThan(1e-6);
      }
    }
  });
