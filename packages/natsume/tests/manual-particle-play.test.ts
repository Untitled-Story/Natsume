import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';

it('retains rate carry and live particles when replaying a Unity burst system', () => {
  const doc = minimalDocument();
  const source = particleSource();
  source.main!.playOnEnable = false;
  source.main!.loop = false;
  source.main!.durationSeconds = 2;
  source.main!.lifetime = constant(1);
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(30), constant(0), [new I.BurstT(0, constant(1))]),
    ),
  );
  doc.components = [new I.ComponentT(4, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
  const sim = new Simulation(pack);
  sim.play();
  sim.playParticleSystem(4);
  const counts: number[] = [];
  for (let frame = 0; frame < 3; frame++) {
    sim.update(1 / 60);
    counts.push(sim.particleCount);
  }
  // Unity 2022.3 Play-mode probe: three frames, repeat Play, then two frames.
  expect(counts).toEqual([1, 2, 2]);
  sim.playParticleSystem(4);
  expect(sim.particleCount).toBe(2);
  expect(sim.emitters.get(4)!.elapsedSeconds).toBe(0);
  sim.update(1 / 60);
  expect(sim.particleCount).toBe(4);
  sim.update(1 / 60);
  expect(sim.particleCount).toBe(4);
  pack.dispose();
});

it('explicitly starts authored manual systems without enabling nodes or bypassing Timeline', () => {
  const doc = minimalDocument();
  doc.nodes.push(new I.NodeT(2, 'child', 1), new I.NodeT(3, 'inactive', 1));
  for (const node of doc.nodes.slice(1)) node.transform = structuredClone(doc.nodes[0]!.transform);
  doc.nodes[2]!.active = false;
  doc.components = doc.nodes.map((node, i) => {
    const source = particleSource();
    source.main!.playOnEnable = false;
    source.main!.durationSeconds = 1;
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1))]),
      ),
    );
    return new I.ComponentT(4 + i, node.id, true, I.ComponentData.ParticleSystem, source);
  });
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
  const sim = new Simulation(pack);
  expect(() => sim.playParticleSystem(999)).toThrow('Unknown particle system');
  expect(() => sim.playParticleSystem(4)).toThrow('Call effect.play()');
  sim.play();
  expect(sim.particleCount).toBe(0);
  sim.playParticleSystem(4, { withChildren: false });
  expect(sim.particleCount).toBe(0);
  sim.update(1 / 60);
  expect([...sim.emitters.values()].map((e) => e.count)).toEqual([1, 0, 0]);
  sim.playParticleSystem(4);
  sim.update(1 / 60);
  expect([...sim.emitters.values()].map((e) => e.count)).toEqual([2, 1, 0]);
  sim.playParticleSystem(4);
  expect(sim.emitters.get(4)!.elapsedSeconds).toBe(0);
  expect(sim.particleCount).toBe(3);
  sim.update(1 / 60);
  expect(sim.particleCount).toBe(5);
  sim.restart();
  expect(sim.particleCount).toBe(0);
  sim.emitters.get(5)!.timelineControlled = true;
  expect(() => sim.playParticleSystem(4)).toThrow('Timeline owns');
  expect(sim.particleCount).toBe(0);
  sim.pause();
  expect(() => sim.playParticleSystem(4)).toThrow('Call effect.play()');
  pack.dispose();
});
