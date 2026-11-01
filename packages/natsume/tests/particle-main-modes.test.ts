import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
function setup(culling: readonly [number, number] = [0, 0]) {
  const document = minimalDocument();
  const sources = [0, 1].map((clock) => {
    const source = particleSource();
    source.main!.clock = clock;
    source.main!.culling = culling[clock]!;
    source.main!.playOnEnable = true;
    source.main!.loop = true;
    source.main!.durationSeconds = 1;
    source.main!.lifetime = constant(2);
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1), 1, 0, 1)]),
      ),
    );
    return source;
  });
  document.components = sources.map(
    (s, i) => new I.ComponentT(3 + i, 1, true, I.ComponentData.ParticleSystem, s),
  );
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const sim = new Simulation(pack);
  sim.play();
  return { pack, sim, sources };
}
it('advances unscaled particles at zero scaled time and keeps both fractional clocks independent', () => {
  const { pack, sim } = setup();
  try {
    expect(() => sim.update(0)).toThrow(/Unscaled particles/);
    sim.update(0, { unscaledDeltaSeconds: 1 / 120 });
    expect(sim.emitters.get(4)!.ages[0]).toBe(0);
    sim.update(0, { unscaledDeltaSeconds: 1 / 120 });
    expect(sim.emitters.get(4)!.ages[0]).toBeCloseTo(1 / 60, 6);
    expect(sim.emitters.get(3)!.ages[0]).toBe(0);
    expect(sim.time).toBe(0);
    sim.update(2 / 60, { unscaledDeltaSeconds: 1 / 60 });
    expect(sim.emitters.get(3)!.ages[0]).toBeCloseTo(2 / 60, 6);
    expect(sim.emitters.get(4)!.ages[0]).toBeCloseTo(2 / 60, 6);
    sim.pause();
    sim.update(1, { unscaledDeltaSeconds: 1 });
    expect(sim.emitters.get(4)!.ages[0]).toBeCloseTo(2 / 60, 6);
    sim.play();
    sim.restart();
    sim.update(0, { unscaledDeltaSeconds: 1 / 60 });
    expect(sim.emitters.get(4)!.ages[0]).toBeCloseTo(1 / 60, 6);
  } finally {
    pack.dispose();
  }
});
it('applies culling visibility independently, preserves visibility on restart and keeps Timeline simulation explicit', () => {
  const { pack, sim } = setup([I.ParticleCulling.Pause, I.ParticleCulling.AlwaysSimulate]);
  try {
    sim.setParticleSystemVisible(3, false);
    sim.setParticleSystemVisible(4, false);
    sim.update(1 / 60, { unscaledDeltaSeconds: 1 / 60 });
    expect(sim.emitters.get(3)!.ages[0]).toBe(0);
    expect(sim.emitters.get(4)!.ages[0]).toBeCloseTo(1 / 60, 6);
    sim.restart();
    expect(sim.emitters.get(3)!.visible).toBe(false);
    sim.setParticleSystemVisible(3, true);
    sim.update(1 / 60, { unscaledDeltaSeconds: 0 });
    expect(sim.emitters.get(3)!.ages[0]).toBeCloseTo(1 / 60, 6);
    expect(sim.emitters.get(4)!.ages[0]).toBe(0);
    sim.setParticleSystemVisible(3, false);
    sim.emitters.get(3)!.timelineControlled = true;
    sim.subEmitters.stepControlled(1 / 60, new Set([3]));
    expect(sim.emitters.get(3)!.ages[0]).toBeCloseTo(2 / 60, 6);
    expect(() => sim.setParticleSystemVisible(99, true)).toThrow(/Unknown particle/);
    expect(() => sim.setParticleSystemVisible(3, 1 as never)).toThrow(/boolean/);
  } finally {
    pack.dispose();
  }
});

interface MainCase {
  action: number;
  stop: number;
  child: boolean;
  trail: boolean;
  frames: {
    frame: number;
    callbacks: number;
    active: boolean;
    exists: boolean;
    count: number;
    childCount: number;
  }[];
}

const mainNative = JSON.parse(readNativeFixture('unity-particle-main-playback.json')) as {
  cases: MainCase[];
};
it('matches native StopAction frames for natural completion, drain, clear, children and retained trails', () => {
  let maxFrame = 0;
  for (const c of mainNative.cases) {
    const doc = minimalDocument();
    const source = particleSource();
    source.main!.playOnEnable = true;
    source.main!.durationSeconds = 0.2;
    source.main!.lifetime = constant(0.1);
    source.main!.stopAction = c.action;
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1), 1, 0, 1)]),
      ),
    );
    if (c.trail) {
      source.main!.speed = constant(1);
      const t = new I.TrailsModuleT();
      t.ratio = 1;
      t.lifetime = constant(0.3);
      t.minVertexDistance = 0.001;
      t.dieWithParticles = false;
      t.widthOverTrail = constant(1);
      t.colorOverLifetime = new I.ColorParameterT();
      t.colorOverTrail = new I.ColorParameterT();
      source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.TrailsModule, t));
    }
    doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
    if (c.child) {
      const node = structuredClone(doc.nodes[0]!);
      node.id = 5;
      node.parentId = 1;
      doc.nodes.push(node);
      const child = structuredClone(source);
      child.main!.lifetime = constant(0.4);
      child.main!.stopAction = 0;
      child.modules = child.modules.filter((m) => m.dataType !== I.ParticleModuleData.TrailsModule);
      doc.components.push(new I.ComponentT(4, 5, true, I.ComponentData.ParticleSystem, child));
    }
    const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
    const sim = new Simulation(pack);
    let callbacks = 0,
      actionFrame: number | undefined;
    sim.onParticleSystemStopped = (e) => {
      expect(e).toEqual({ systemId: 3, nodeId: 1 });
      callbacks++;
    };
    sim.play();
    try {
      for (const frame of c.frames) {
        if (frame.frame) sim.update(1 / 60);
        if (frame.frame === 3 && c.stop) sim.stop(c.stop === 1 ? 'drain' : 'clear');
        const node = sim.scene.nodes.get(1)!;
        const actionHappened =
          c.action === 1
            ? !node.active
            : c.action === 2
              ? node.destroyed
              : c.action === 3
                ? callbacks > 0
                : false;
        if (actionHappened && actionFrame === undefined) actionFrame = frame.frame;
      }
      if (c.action) {
        const expected = c.frames.find((f) =>
          c.action === 1 ? !f.active : c.action === 2 ? !f.exists : f.callbacks > 0,
        )?.frame;
        expect(
          actionFrame,
          JSON.stringify({ action: c.action, stop: c.stop, child: c.child, trail: c.trail }),
        ).toBeDefined();
        maxFrame = Math.max(maxFrame, Math.abs(actionFrame! - expected!));
        expect(
          actionFrame,
          JSON.stringify({ action: c.action, stop: c.stop, child: c.child, trail: c.trail }),
        ).toBe(expected);
        expect(callbacks).toBe(c.action === 3 ? 1 : 0);
      }
      sim.restart();
      expect(sim.scene.nodes.get(1)!.destroyed).toBe(false);
      expect(sim.scene.nodes.get(1)!.active).toBe(true);
    } finally {
      pack.dispose();
    }
  }
  expect(maxFrame).toBe(0);
  recordError(
    'particle-stop-action-frame',
    maxFrame,
    'frame',
    `${mainNative.cases.length} cases × 40 frames`,
  );
});
