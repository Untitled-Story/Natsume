import { describe, expect, it } from 'vitest';
import { timelinePack } from './timeline-pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { timelineTrackClips } from '../src/runtime/timeline-time.js';
import { TimelineClipT } from '../src/format/generated/noa/ir/timeline-clip.js';
import { TimelineTrackT } from '../src/format/generated/noa/ir/timeline-track.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { TimelineControlT } from '../src/format/generated/noa/ir/timeline-control.js';
import { TypedReferenceT } from '../src/format/generated/noa/ir/typed-reference.js';
import * as I from '../src/format/generated/noa/ir.js';
import { particleSource, constant } from './particle-fixtures.js';

function controlPack() {
  return timelinePack((source) => {
    const track = source.timeline!.tracks[0]!;
    track.kind = 3;
    track.target = null;
    const clip = track.clips[0]!;
    clip.dataType = 2;
    clip.data = new TimelineControlT(
      'subject',
      new TypedReferenceT(1, 4),
      false,
      42,
      false,
      true,
      true,
      true,
      2,
    );
  });
}
describe('Timeline instance boundaries', () => {
  it('claims sub-emitter pools, keeps released pools paused and restores ordinary clocks and seeds on restart', () => {
    const pack = timelinePack((source, document) => {
      source.playOnAwake = false;
      const track = source.timeline!.tracks[0]!;
      track.kind = 3;
      track.target = null;
      track.clips[0]!.dataType = 2;
      track.clips[0]!.data = new TimelineControlT(
        'subject',
        new TypedReferenceT(1, 4),
        true,
        42,
        false,
        false,
        false,
        false,
        2,
      );
      for (const [id, node] of [
        [6, 4],
        [7, 5],
        [8, 1],
      ] as const) {
        const particle = particleSource();
        particle.main!.seedMode = I.SeedMode.PerInstance;
        particle.main!.loop = true;
        particle.main!.clock = id === 8 ? I.ParticleClock.Scaled : I.ParticleClock.Unscaled;
        particle.modules.push(
          new I.ParticleModuleT(
            I.ParticleModuleData.EmissionModule,
            new I.EmissionModuleT(constant(10), constant(0)),
          ),
        );
        if (id === 6)
          particle.modules.push(
            new I.ParticleModuleT(
              I.ParticleModuleData.SubEmittersModule,
              new I.SubEmittersModuleT([new I.SubEmitterT(7, I.SubEmitterEvent.Birth, 0, 1)]),
            ),
          );
        document.components.push(
          new I.ComponentT(id, node, true, I.ComponentData.ParticleSystem, particle),
        );
      }
    });
    try {
      const sim = new Simulation(pack, { seed: 123 });
      const [root, child, ordinary] = [6, 7, 8].map((id) => sim.emitters.get(id)!);
      const initialSeeds = [root!.seed, child!.seed];
      sim.play();
      const director = sim.getDirector(3);
      director.setTime(0.5);
      director.evaluate();
      expect([
        root!.timelineControlled,
        child!.timelineControlled,
        ordinary!.timelineControlled,
      ]).toEqual([true, true, false]);
      expect([root!.seed, child!.seed]).toEqual([42, 43]);
      expect(root!.elapsedSeconds).toBeGreaterThan(0);
      const times = [root!.elapsedSeconds, child!.elapsedSeconds];
      director.stop();
      sim.update(1 / 60); // Controlled unscaled pools require no ordinary host clock.
      expect([root!.elapsedSeconds, child!.elapsedSeconds]).toEqual(times);
      expect(ordinary!.elapsedSeconds).toBeCloseTo(1 / 60, 6);
      expect(() => sim.playParticleSystem(6)).toThrow('Timeline owns');
      sim.restart();
      expect([root!.timelineControlled, child!.timelineControlled]).toEqual([false, false]);
      expect([root!.seed, child!.seed]).toEqual(initialSeeds);
      expect(() => sim.update(1 / 60)).toThrow('Unscaled particles');
      sim.update(1 / 60, { unscaledDeltaSeconds: 2 / 60 });
      expect(root!.elapsedSeconds).toBeCloseTo(2 / 60, 6);
      expect(ordinary!.elapsedSeconds).toBeCloseTo(1 / 60, 6);
    } finally {
      pack.dispose();
    }
  });
  it('activates at an exact fixed-step boundary and restores only at the next update', () => {
    const sim = new Simulation(
      timelinePack((source) => {
        source.clock = 1;
      }),
    );
    sim.play();
    for (let frame = 0; frame < 14; frame++) sim.update(1 / 60);
    expect(sim.scene.nodes.get(4)!.active).toBe(false);
    sim.update(1 / 60);
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
    sim.getDirector(3).setTime(0);
    sim.getDirector(3).evaluate();
    sim.getDirector(3).stop();
    expect(sim.scene.nodes.get(4)!.active).toBe(false);
    sim.update(0);
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
  });
  it('rejects a wrong binding kind without discarding the running graph', () => {
    const sim = new Simulation(timelinePack());
    const director = sim.getDirector(3);
    director.setTime(0);
    director.evaluate();
    expect(() => director.setBinding({ guid: 'track', fileId: 0n }, { componentId: 3 })).toThrow(
      'requires a node',
    );
    expect(sim.scene.nodes.get(4)!.active).toBe(false);
    director.setTime(0.5);
    director.evaluate();
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
    director.setBinding({ guid: 'track', fileId: 0n }, null);
    director.setTime(0);
    director.evaluate();
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
  });
  it('keeps identical-start clips distinct when deriving extrapolation', () => {
    const a = Object.assign(new TimelineClipT(), { start: 1, duration: 2 });
    const b = Object.assign(new TimelineClipT(), { start: 1, duration: 3 });
    const result = timelineTrackClips([a, b]);
    expect(result.map((c) => c.duration)).toEqual([2, 3]);
    expect(result[0]!.postExtrapolationTime).toBe(0);
    expect(a.postExtrapolationTime).toBe(0);
    expect(result[1]!.postExtrapolationTime).toBe(Infinity);
  });
  it('restarts at source initial time and retains explicit binding overrides', () => {
    const sim = new Simulation(
      timelinePack((source) => {
        source.initialTime = 0.5;
      }),
    );
    const director = sim.getDirector(3);
    director.setBinding({ guid: 'track', fileId: 0n }, { nodeId: 5 });
    director.setTime(0);
    director.evaluate();
    sim.restart();
    expect(sim.getDirector(3)).toBe(director);
    expect(director.time).toBe(0.5);
    director.evaluate();
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
    expect(sim.scene.nodes.get(5)!.active).toBe(true);
  });
  it('pairs control callbacks across pause, exposed rebinding and disposal', () => {
    const sim = new Simulation(controlPack());
    const calls: string[] = [];
    sim.onControlTime = (id, phase) => {
      calls.push(`${id}:${phase}`);
    };
    const director = sim.getDirector(3);
    director.setTime(0.5);
    director.evaluate();
    director.pause();
    expect(sim.scene.nodes.get(4)!.active).toBe(true);
    expect(calls).toEqual(['4:start', '4:sample', '4:stop']);
    director.setBinding({ exposedName: 'subject' }, { nodeId: 5 });
    director.evaluate();
    sim.disposeDirectors();
    expect(calls.slice(3)).toEqual(['5:start', '5:sample', '5:stop']);
    expect(sim.scene.nodes.get(5)!.active).toBe(true);
  });
  it('cancels a sampled batch when a start callback stops its Director', () => {
    const sim = new Simulation(controlPack());
    const director = sim.getDirector(3);
    const calls: string[] = [];
    sim.onControlTime = (_, phase) => {
      calls.push(phase);
      if (phase === 'start') director.stop();
    };
    director.setTime(0.5);
    director.evaluate();
    expect(calls).toEqual(['start']);
    sim.flushDirectors();
    expect(calls).toEqual(['start', 'stop']);
    expect(director.state).toBe('stopped');
  });
});

it('follows ordered root indexes rather than track storage order', () => {
  const pack = timelinePack((source) => {
    const first = source.timeline!.tracks[0]!;
    const second = new TimelineTrackT(new SourceReferenceT('second', 1n), 'second', 1);
    second.target = new TypedReferenceT(1, 4);
    second.clips = [Object.assign(new TimelineClipT(), { start: 1, duration: 1 })];
    first.clips = [Object.assign(new TimelineClipT(), { start: 0, duration: 1 })];
    source.timeline!.tracks.push(second);
    source.timeline!.roots = [1, 0];
  });
  const sim = new Simulation(pack);
  const director = sim.getDirector(3);
  director.setTime(0.5);
  director.evaluate();
  expect(sim.scene.nodes.get(4)!.active).toBe(true);
});
