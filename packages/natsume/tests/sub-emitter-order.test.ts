import { expect, it } from 'vitest';
import { EffectPack } from '../src/pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';

function fixture(order?: readonly number[]) {
  const document = minimalDocument();
  for (let id = 3; id <= 5; id++) {
    const source = particleSource(),
      m = source.main!;
    m.durationSeconds = 2;
    m.loop = false;
    m.prewarm = false;
    m.playOnEnable = true;
    m.lifetime = constant(id === 5 ? 0.4 : 1);
    m.speed = constant(0);
    source.modules.push(
      new ParticleModuleT(
        M.EmissionModule,
        new EmissionModuleT(constant(id === 5 ? 30 : 0), constant(0)),
      ),
    );
    if (id !== 5)
      source.modules.push(
        new ParticleModuleT(
          M.SubEmittersModule,
          new SubEmittersModuleT([new SubEmitterT(5, 0, 0, 1)]),
        ),
      );
    document.components.push(new ComponentT(id, 1, true, C.ParticleSystem, source));
  }
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  return new Simulation(pack, order ? { seed: 123, subEmitterUpdateOrder: order } : { seed: 123 });
}
function seed(s: Simulation) {
  for (const id of [3, 4])
    s.emitters.get(id)!.emitSubParticles(
      1,
      0,
      0,
      {
        id: 0,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        color: [1, 1, 1, 1],
        age: 0,
        lifetime: 1,
        remainingLifetime: 1,
      },
      0,
    );
}
function snapshot(s: Simulation) {
  return s.getParticles(5).map((p) => [p.id, p.age, ...p.position]);
}
it('retains host job order across restart and copies both constructor and setter inputs', () => {
  const input = [5, 3, 5, 4],
    s = fixture(input),
    control = fixture(input);
  input.fill(999);
  s.play();
  control.play();
  seed(s);
  seed(control);
  for (let i = 0; i < 6; i++) {
    s.update(1 / 60);
    control.update(1 / 60);
  }
  const initial = snapshot(s);
  expect(initial).toEqual(snapshot(control));
  s.restart();
  seed(s);
  for (let i = 0; i < 6; i++) s.update(1 / 60);
  expect(snapshot(s)).toEqual(initial);
  const deferred = [5, 5, 3, 4];
  s.setSubEmitterUpdateOrder(deferred);
  deferred.fill(999);
  s.restart();
  seed(s);
  control.setSubEmitterUpdateOrder([5, 5, 3, 4]);
  control.restart();
  seed(control);
  for (let i = 0; i < 6; i++) {
    s.update(1 / 60);
    control.update(1 / 60);
  }
  expect(snapshot(s)).toEqual(snapshot(control));
  expect(snapshot(s)).not.toEqual(initial);
});
it('restores default scheduling without clearing current particles', () => {
  const s = fixture([5, 5, 3, 4]),
    control = fixture();
  s.play();
  control.play();
  seed(s);
  seed(control);
  for (let i = 0; i < 5; i++) {
    s.update(1 / 60);
    control.update(1 / 60);
  }
  expect(snapshot(s)).toEqual(snapshot(control));
  const before = snapshot(s);
  s.setSubEmitterUpdateOrder(undefined);
  expect(snapshot(s)).toEqual(before);
  for (let i = 0; i < 10; i++) {
    s.update(1 / 60);
    control.update(1 / 60);
  }
  expect(snapshot(s)).toEqual(snapshot(control));
});
