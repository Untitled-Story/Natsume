import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { copyEnvironment } from '../src/rendering/particle-environment.js';
import { Emitter } from '../src/runtime/emitter.js';
import type { ParticleLightState, ParticleLightTemplate } from '../src/runtime/particle-lights.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { constant, linear, manualParticle, particleSource } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

function definition() {
  return new I.LightsModuleT(
    1,
    false,
    false,
    false,
    false,
    64,
    new I.EnvironmentReferenceT(I.EnvironmentKind.Light, null, null, 'light'),
    constant(0.7),
    constant(0.6),
  );
}
async function setup(d = definition()) {
  const pack = await loadPack(await archive());
  const source = particleSource();
  source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.LightsModule, d));
  const states = new Map<
    number,
    { position: number[]; color: number[]; range: number; intensity: number }
  >();
  let created = 0,
    destroyed = 0;
  const template: ParticleLightTemplate = {
    color: [0.4, 0.6, 0.8],
    range: 3,
    intensity: 2,
    create() {
      created++;
      let id: number;
      return {
        update(s: ParticleLightState) {
          id = s.particleId;
          states.set(id, {
            position: [...s.position],
            color: [...s.color],
            range: s.range,
            intensity: s.intensity,
          });
        },
        destroy() {
          destroyed++;
          states.delete(id);
        },
      };
    },
  };
  const environment = copyEnvironment({ fog: { mode: 'none' }, lights: { light: template } })!;
  const diagnostics: { code: string; message: string }[] = [];
  const e = new Emitter(
    5,
    new Scene(pack, [1]).nodes.get(1)!,
    source,
    true,
    1,
    diagnostics,
    undefined,
    undefined,
    undefined,
    environment,
  );
  manualParticle(e);
  return { pack, e, states, template, diagnostics, counters: () => ({ created, destroyed }) };
}

interface NativeDistribution {
  ratio: number;
  maximum: number;
  seed: number;
  random: boolean;
  lit: number[];
  mortality: boolean;
  afterDeath: number[];
  afterBirth: number[];
}
const distribution = JSON.parse(readNativeFixture('unity-particle-light-distribution.json')) as {
  cases: NativeDistribution[];
};
const native = JSON.parse(readNativeFixture('unity-particle-lights.json')) as {
  cases: {
    curve: boolean;
    switches: number;
    phase: number;
    range: number;
    intensity: number;
    replaceError: number;
  }[];
};

it('matches native light colors, size/alpha switches and age curves', async () => {
  let maxPixel = 0;
  for (const c of native.cases) {
    const d = definition();
    d.useParticleColor = !!(c.switches & 1);
    d.sizeAffectsRange = !!(c.switches & 2);
    d.alphaAffectsIntensity = !!(c.switches & 4);
    if (c.curve) {
      d.rangeMultiplier = linear(0.2, 1.2);
      d.intensityMultiplier = linear(0.3, 1.5);
    }
    const { pack, e, states } = await setup(d);
    try {
      e.lifetimes[0] = 4;
      e.ages[0] = c.phase * 4;
      e.startSizes.set([2, 2, 2]);
      e.startColors.set([0.25, 0.5, 0.75, 0.5]);
      e.lights!.sync(e);
      const state = states.get(0)!;
      expect(state.range).toBeCloseTo(3 * c.range * (d.sizeAffectsRange ? 2 : 1), 5);
      expect(state.intensity).toBeCloseTo(2 * c.intensity * (d.alphaAffectsIntensity ? 0.5 : 1), 5);
      expect(state.color).toEqual(
        d.useParticleColor
          ? [0.25, 0.5, 0.75]
          : [Math.fround(0.4), Math.fround(0.6), Math.fround(0.8)],
      );
      maxPixel = Math.max(maxPixel, c.replaceError);
    } finally {
      e.clear();
      pack.dispose();
    }
  }
  expect(maxPixel).toBeLessThanOrEqual(1);
  recordError('particle-light-reference-pixel', maxPixel, 'RGBA8', `${native.cases.length} cases`);
});

it('matches native deterministic selection, caps and survivor promotion; compares pooled random selection', async () => {
  const d = definition(),
    { pack, e, states } = await setup(d);
  let selected = 0,
    nativeSelected = 0,
    births = 0;
  try {
    for (const c of distribution.cases) {
      e.lights!.clear();
      d.ratio = c.ratio;
      d.maxLights = c.maximum;
      d.randomDistribution = c.random;
      // Fixed seeds use the authored seed directly.
      e.seed = c.seed;
      e.count = 64;
      for (let i = 0; i < 64; i++) {
        e.serials[i] = i;
        e.ages[i] = 0;
        e.lifetimes[i] = 100;
        e.startSizes.fill(1, i * 3, i * 3 + 3);
        e.startColors.fill(1, i * 4, i * 4 + 4);
      }
      e.lights!.sync(e);
      if (!c.random) expect([...states.keys()]).toEqual(c.lit);
      if (c.seed >= 1000) {
        selected += states.size;
        nativeSelected += c.lit.length;
        births += 64;
      }
      if (c.mortality) {
        e.count = 63;
        e.serials[0] = 63;
        e.lights!.sync(e);
        expect([...states.keys()]).toEqual(c.afterDeath);
        e.count = 64;
        e.serials[63] = 64;
        e.lights!.sync(e);
        // Last birth is at position 0; surviving light remains at position 63.
        expect([...states.keys()]).toEqual(c.afterBirth);
      }
    }
    const relative = Math.abs(selected - nativeSelected) / nativeSelected;
    expect(relative).toBeLessThan(0.1);
    recordError(
      'particle-light-random-frequency',
      relative,
      'relative',
      `${births} births; native ${nativeSelected}, runtime ${selected}`,
    );
  } finally {
    e.clear();
    pack.dispose();
  }
});

it('reuses owned handles, updates world values, replaces templates and releases on lifecycle changes', async () => {
  const { pack, e, states, template, counters, diagnostics } = await setup();
  try {
    e.lights!.sync(e);
    e.lights!.sync(e);
    expect(counters()).toEqual({ created: 1, destroyed: 0 });
    expect(states.get(0)!.position).toEqual([1, 0.5, 0.20000000298023224]);
    const slots = { light: template };
    const copied = copyEnvironment({ fog: { mode: 'none' }, lights: slots })!;
    delete (slots as Partial<typeof slots>).light;
    expect(copied.lights!.light).toBe(template);
    expect(() => e.resolveEnvironment({ fog: { mode: 'none' } })).toThrow(/template light/);
    e.environment = { fog: { mode: 'none' }, lights: { light: { ...template } } };
    e.lights!.sync(e);
    expect(counters()).toEqual({ created: 2, destroyed: 1 });
    e.clear();
    e.clear();
    expect(counters()).toEqual({ created: 2, destroyed: 2 });
    expect(diagnostics).toEqual([]);
  } finally {
    e.clear();
    pack.dispose();
  }
});

it('creates no lights for a null reference and isolates release failures', async () => {
  const d = definition(),
    { pack, e, diagnostics } = await setup(d);
  try {
    e.environment = {
      fog: { mode: 'none' },
      lights: {
        light: {
          color: [1, 1, 1],
          range: 1,
          intensity: 1,
          create: () => ({
            update() {},
            destroy() {
              throw new Error('release');
            },
          }),
        },
      },
    };
    e.lights!.sync(e);
    e.clear();
    expect(diagnostics.map((x) => x.code)).toEqual(['PARTICLE_LIGHT_RELEASE_ERROR']);
    d.light!.hostSlot = null;
    manualParticle(e);
    e.lights!.sync(e);
    expect(() =>
      copyEnvironment({
        fog: { mode: 'none' },
        lights: { light: { color: [1, 1, 1], range: NaN, intensity: 1, create: () => null! } },
      }),
    ).toThrow(/template/);
  } finally {
    e.clear();
    pack.dispose();
  }
});
