import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { Simulation } from '../src/runtime/simulation.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
interface Row {
  frame: number;
  time: number;
  count: number;
  delta: number;
  unscaledDelta: number;
  visible: boolean;
}
interface Case {
  mode: number;
  loop: boolean;
  unscaled: boolean;
  fixedDelta: number;
  speed: number;
  frames: Row[];
}
function sourceFor(c: Case) {
  const source = particleSource();
  source.main!.playOnEnable = true;
  source.main!.loop = c.loop;
  source.main!.clock = c.unscaled ? 1 : 0;
  source.main!.culling = c.mode;
  source.main!.durationSeconds = 2;
  source.main!.lifetime = constant(2);
  source.main!.simulationSpeed = c.speed ?? 1;
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(30), constant(0), []),
    ),
  );
  return source;
}
function packFor(source: I.ParticleSystemT) {
  const doc = minimalDocument();
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
  return new EffectPack(doc, { files: [] } as never, new Map(), new Map());
}
const culling = JSON.parse(readNativeFixture('unity-particle-culling-playback.json')) as {
  cases: Case[];
};
it('matches native Automatic, Pause and AlwaysSimulate visibility across both clocks', () => {
  let maxTime = 0,
    maxCount = 0;
  for (const c of culling.cases.filter((c) => c.mode !== 1)) {
    const source = sourceFor(c),
      pack = packFor(source),
      scene = new Scene(pack, [1]);
    const e = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    e.enableLifetimeProgress();
    e.sync();
    try {
      for (const f of c.frames) {
        if (f.frame) {
          e.visible = f.visible;
          e.step(c.unscaled ? f.unscaledDelta : f.delta);
        }
        maxTime = Math.max(maxTime, Math.abs(e.elapsedSeconds - f.time));
        maxCount = Math.max(maxCount, Math.abs(e.count - f.count));
      }
    } finally {
      pack.dispose();
    }
  }
  expect(maxTime).toBeLessThan(2e-5);
  expect(maxCount).toBe(0);
  recordError('particle-culling-time', maxTime, 'second', '36 cases × 50 frames');
  recordError('particle-culling-count', maxCount, 'particle', '36 cases × 50 frames');
});
const clocks = JSON.parse(readNativeFixture('unity-particle-clock-playback.json')) as {
  cases: (Case & { timeScale: number })[];
};
it('matches native clocks at three time scales and simulation speeds, including timeScale zero', () => {
  let maxTime = 0,
    maxCount = 0,
    maxFixedTime = 0,
    maxFixedCount = 0,
    maxFinalRelative = 0;
  for (const c of clocks.cases) {
    const source = sourceFor({ ...c, loop: true, mode: 3 });
    source.main!.durationSeconds = 10;
    source.main!.lifetime = constant(10);
    source.main!.maxParticles = 4096;
    const pack = packFor(source),
      scene = new Scene(pack, [1]),
      e = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    e.enableLifetimeProgress();
    e.sync();
    const sim = new Simulation(pack);
    sim.play();
    try {
      for (const f of c.frames) {
        if (f.frame) {
          e.step(c.unscaled ? f.unscaledDelta : f.delta);
          sim.update(f.delta, { unscaledDeltaSeconds: f.unscaledDelta });
        }
        maxTime = Math.max(maxTime, Math.abs(e.elapsedSeconds - f.time));
        maxCount = Math.max(maxCount, Math.abs(e.count - f.count));
        const diff = Math.abs(sim.emitters.get(3)!.elapsedSeconds - f.time);
        maxFixedTime = Math.max(maxFixedTime, diff);
        maxFixedCount = Math.max(maxFixedCount, Math.abs(sim.particleCount - f.count));
        if (f.frame === 69 && f.time > 0)
          maxFinalRelative = Math.max(maxFinalRelative, diff / f.time);
      }
    } finally {
      pack.dispose();
    }
  }
  expect(maxTime).toBeLessThan(3e-5);
  expect(maxCount).toBe(0);
  expect(maxFixedTime).toBeLessThan(1 / 30 + 3e-5);
  expect(maxFixedCount).toBeLessThanOrEqual(1);
  expect(maxFinalRelative).toBeLessThan(0.03);
  recordError('particle-clock-native-time', maxTime, 'second', '18 cases × 70 frames');
  recordError('particle-clock-native-count', maxCount, 'particle', '18 cases × 70 frames');
  recordError('particle-clock-fixed-time', maxFixedTime, 'second', '18 cases × 70 frames');
  recordError('particle-clock-fixed-count', maxFixedCount, 'particle', '18 cases × 70 frames');
  recordError(
    'particle-clock-final-relative',
    maxFinalRelative,
    'relative',
    '18 cases, 70 frames each',
  );
});
