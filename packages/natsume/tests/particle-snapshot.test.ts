import { expect, it } from 'vitest';
import { Emitter } from '../src/runtime/emitter.js';
import { particleSnapshot } from '../src/runtime/particle-snapshot.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant, vector, linear } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { SizeModuleT } from '../src/format/generated/noa/ir/size-module.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { Simulation } from '../src/runtime/simulation.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';

it('retains disabled emission parameters without automatically emitting particles', () => {
  const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]);
  const source = particleSource();
  const emission = new EmissionModuleT(
    constant(60),
    constant(10),
    [new BurstT(0, constant(2), 1, 0, 1)],
    false,
  );
  source.modules.push(new ParticleModuleT(M.EmissionModule, emission));
  const e = new Emitter(3, scene.nodes.get(1)!, source, true, 123, []);
  e.sync();
  e.step(1 / 60);
  scene.nodes.get(1)!.worldMatrix[12] = 10;
  e.updateSpace();
  e.step(1 / 60);
  expect(e.count).toBe(0);
  expect(e.emission!.bursts).toHaveLength(1);
  expect(e.emission!.rateOverTime!.constantMax).toBe(60);
  e.emitTriggeredBurst(
    {
      id: 9,
      position: [3, 4, 5],
      velocity: [0, 0, 0],
      size: [2, 2, 2],
      rotation: [0, 0, 0.5],
      color: [0.2, 0.4, 0.6, 0.8],
      age: 0.1,
      lifetime: 0.2,
      remainingLifetime: 0.1,
    },
    31,
  );
  expect(e.count).toBe(2);
  const child = particleSnapshot(e, 0);
  expect(child.position).toEqual([3, 4, 5]);
  expect(child.size).toEqual([2, 2, 2]);
  expect(child.rotation[2]).toBeCloseTo(0.5);
  expect(child.lifetime).toBeCloseTo(0.2);
  expect(child.color[0]).toBeCloseTo(0.2);
});

it('validates host trigger targets before changing particle storage', () => {
  const document = minimalDocument();
  document.components = [
    new ComponentT(3, 1, true, ComponentData.ParticleSystem, particleSource()),
  ];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const simulation = new Simulation(pack);
  expect(() => simulation.emitSubEmitter(99, 0)).toThrow('Unknown particle system');
  expect(() => simulation.emitSubEmitter(3, 0)).toThrow('Unknown sub-emitter slot');
  expect(simulation.particleCount).toBe(0);
});

it('reports lifecycle velocity before any renderer or sub-emitter attaches', () => {
  const document = minimalDocument();
  const source = particleSource('motion-linear');
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(1), 1, 0, 1)]),
    ),
  );
  document.components = [new ComponentT(3, 1, true, ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const simulation = new Simulation(pack);
  simulation.play();
  simulation.update(1 / 60);
  const particle = simulation.getParticles(3)[0]!;
  expect(particle.velocity).toEqual([1, 2, 3]);
  expect(particle.position[0]).toBeCloseTo(1 / 60);
  expect(particle.position[1]).toBeCloseTo(2 / 60);
  expect(particle.position[2]).toBeCloseTo(3 / 60);
});

it('copies world-space state and evaluates authored lifetime size without changing the particle', () => {
  const d = minimalDocument();
  d.nodes[0]!.transform!.position!.x = 3;
  const pack = new EffectPack(d, { files: [] } as never, new Map(), new Map()),
    scene = new Scene(pack, [1]);
  const source = particleSource();
  source.main!.color = new ColorParameterT(0, null, new ColorT(0.2, 0.4, 0.6, 0.8));
  source.main!.speed = constant(2);
  source.main!.size = vector(2, 2, 2);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(2), 1, 0, 1)]),
    ),
    new ParticleModuleT(
      M.SizeModule,
      new SizeModuleT(Object.assign(vector(), { x: linear(1, 2) })),
    ),
  );
  const e = new Emitter(3, scene.nodes.get(1)!, source, true, 123, []);
  e.sync();
  e.step(1 / 60);
  const a = particleSnapshot(e, 0),
    b = particleSnapshot(e, 1);
  expect(a.id).not.toBe(b.id);
  expect(a.position[0]).toBe(3);
  expect(a.position[2]).toBeCloseTo(2 / 60);
  expect(a.velocity).toEqual([0, 0, 2]);
  expect(a.size[0]).toBeCloseTo(2 * (1 + 1 / 60 / 2));
  expect(a.color[0]).toBeCloseTo(0.2);
  expect(a.remainingLifetime).toBeCloseTo(2 - 1 / 60);
  Reflect.set(a.position, 0, 99);
  expect(particleSnapshot(e, 0).position[0]).toBe(3);
  // The first death compacts the last particle into its slot without changing its identity.
  e.lifetimes[0] = 1e-6;
  e.step(1 / 60);
  expect(e.count).toBe(1);
  expect(particleSnapshot(e, 0).id).toBe(b.id);
});
