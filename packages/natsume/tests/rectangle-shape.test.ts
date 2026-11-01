import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';

it('instantiates the rectangle capability and applies Shape TRS with deterministic replay', () => {
  const doc = minimalDocument();
  const source = particleSource();
  source.main!.playOnEnable = true;
  source.main!.speed = constant(1);
  const transform = new I.TransformT(
    new I.Vec3T(4, 5, 6),
    new I.QuaternionT(0, Math.SQRT1_2, 0, Math.SQRT1_2),
    new I.Vec3T(2, 3, 0),
  );
  source.modules = [
    new I.ParticleModuleT(
      I.ParticleModuleData.ShapeModule,
      new I.ShapeModuleT(null, I.ShapeGeometry.RectangleShape, new I.RectangleShapeT(), transform),
    ),
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(32), 1, 0, 1)]),
    ),
  ];
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
  doc.features = [new I.FeatureRequirementT('particle.shape.rectangle', 1, true)];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
  const sim = new Simulation(pack, { seed: 123 });
  try {
    sim.play();
    const emitter = sim.emitters.get(3)!;
    expect(emitter.count).toBe(32);
    const initial = emitter.positions.slice();
    for (let i = 0; i < emitter.count; i++) {
      const o = i * 3;
      expect(emitter.positions[o]).toBeCloseTo(4, 5);
      expect(Math.abs(emitter.positions[o + 1]! - 5)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(emitter.positions[o + 2]! - 6)).toBeLessThanOrEqual(1);
      expect(emitter.velocities[o]).toBeCloseTo(1, 6);
      expect(emitter.velocities[o + 1]).toBeCloseTo(0, 6);
      expect(emitter.velocities[o + 2]).toBeCloseTo(0, 6);
    }
    sim.restart();
    expect(emitter.positions).toEqual(initial);
  } finally {
    pack.dispose();
  }
});
