import { expect, it } from 'vitest';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { Emitter } from '../src/runtime/emitter.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { SubEmitterT } from '../src/format/generated/noa/ir/sub-emitter.js';
import { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';
const native = JSON.parse(readNativeFixture('unity-sub-emitter-playback.json')) as {
  cases: PlaybackCase[];
};
interface Particle {
  age: number;
  position: { x: number; y: number; z: number };
}
interface PlaybackCase {
  rootLifetime: number;
  childLifetime: number;
  grandLifetime: number;
  duration: number;
  rate: number;
  topology: number;
  firstEvent: number;
  secondEvent: number;
  warm: boolean;
  delay: boolean;
  samples: { parent: Particle[]; child: Particle[]; grand: Particle[]; time: number }[];
}
for (const [caseIndex, c] of native.cases.entries()) {
  if (c.delay) continue;
  it('matches actual player-loop connected prewarm and births ' + caseIndex, () => {
    const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map()),
      scene = new Scene(pack, [1]);
    const emitters = [0, 1, 2].map((i) => {
      const source = particleSource(),
        m = source.main!;
      m.maxParticles = 1000;
      m.durationSeconds = i === 0 ? c.duration : 1;
      m.loop = i === 0;
      m.prewarm = i === 0;
      m.playOnEnable = i === 0;
      m.lifetime = constant([c.rootLifetime, c.childLifetime, c.grandLifetime][i]!);
      m.speed = constant(i ? 1 : 0);
      source.modules.push(
        new ParticleModuleT(
          M.EmissionModule,
          new EmissionModuleT(
            constant(i === 0 ? c.rate : 0),
            constant(0),
            i === 0 ? [] : [new BurstT(0, constant(i === 1 ? 2 : 3), 1, 0, 1)],
            i === 0,
          ),
        ),
      );
      const edges = [];
      if (i === 0) edges.push(new SubEmitterT(4, c.firstEvent, 0, 1));
      if (i === 0 && c.topology === 4) edges.push(new SubEmitterT(5, c.secondEvent, 0, 1));
      if (i === 1 && c.topology === 3) edges.push(new SubEmitterT(5, c.secondEvent, 0, 1));
      if (edges.length)
        source.modules.push(
          new ParticleModuleT(M.SubEmittersModule, new SubEmittersModuleT(edges)),
        );
      return new Emitter(i + 3, scene.nodes.get(1)!, source, true, 12345, []);
    });
    const graph = new SubEmitterGraph(new Map(emitters.map((e) => [e.id, e])));
    for (const e of graph.order) e.sync();
    graph.warm();

    let ageError = 0,
      positionError = 0;
    for (let frame = 0; frame < c.samples.length; frame++) {
      if (frame) graph.step(1 / 60);
      const sample = c.samples[frame]!;

      for (let i = 0; i < 3; i++) {
        const emitter = emitters[i]!,
          expected = sample[(['parent', 'child', 'grand'] as const)[i]!];
        expect(emitter.count, 'frame=' + frame + ', system=' + i).toBe(expected.length);
        const actual = Array.from(emitter.ages.subarray(0, emitter.count)).sort((a, b) => a - b);
        const ages = expected.map((p) => p.age).sort((a, b) => a - b);
        for (let j = 0; j < actual.length; j++) {
          const error = Math.abs(actual[j]! - ages[j]!);
          ageError = Math.max(ageError, error);
          expect(error, 'frame=' + frame + ', system=' + i).toBeLessThan(2e-6);
        }
        const positions = Array.from(
          { length: emitter.count },
          (_, j) => emitter.positions[j * 3 + 2]!,
        ).sort((a, b) => a - b);
        const expectedPositions = expected.map((p) => p.position.z).sort((a, b) => a - b);
        for (let j = 0; j < positions.length; j++) {
          const error = Math.abs(positions[j]! - expectedPositions[j]!);
          positionError = Math.max(positionError, error);
          expect(error, 'position frame=' + frame + ', system=' + i).toBeLessThan(2e-5);
        }
      }
    }
    recordError(
      'sub-emitter.player-loop.age',
      ageError,
      'seconds',
      'case ' + caseIndex + ', 181 frames; counts exact',
    );
    recordError(
      'sub-emitter.player-loop.position',
      positionError,
      'scene units',
      'case ' + caseIndex + ', 181 frames',
    );
  });
}
