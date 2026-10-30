import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it, expect } from 'vitest';
import { timelinePack } from './timeline-pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { AnimationEventT } from '../src/format/generated/noa/ir/animation-event.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { Vector3TrackT } from '../src/format/generated/noa/ir/vector3-track.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { TimelineTrackT } from '../src/format/generated/noa/ir/timeline-track.js';
import { TimelineClipT } from '../src/format/generated/noa/ir/timeline-clip.js';
import { TimelineAnimationT } from '../src/format/generated/noa/ir/timeline-animation.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { TypedReferenceT } from '../src/format/generated/noa/ir/typed-reference.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { AnimationProperty } from '../src/format/generated/noa/ir/animation-property.js';

const directory = resolve(import.meta.dirname, '../../../data/unity-baselines/timeline-playback');
interface Row {
  clock: number;
  wrap: number;
  samples: {
    time: number;
    active: boolean;
    state: string;
    events: number;
    x: number;
    eventX: number;
  }[];
}
it.skipIf(!existsSync(directory + '/unity-2022.3.21f1.json'))(
  'replays native Director PlayerLoop clocks and wrap boundaries',
  () => {
    const native = JSON.parse(readFileSync(directory + '/unity-2022.3.21f1.json', 'utf8')) as {
      cases: Row[];
      clocks: { scaled: number; unscaled: number; dsp: number }[];
      dspBufferLength: number;
      sampleRate: number;
    };
    const results = [];
    for (const row of native.cases) {
      const pack = timelinePack((source, document) => {
        source.clock = row.clock;
        source.wrap = row.wrap;
        source.initialTime = 0.2;
        source.timeline!.durationMode = 1;
        source.timeline!.fixedDuration = 0.75;
        document.components.push(new ComponentT(8, 1, true, C.Animator, new AnimatorT()));
        const curve = Object.assign(new ScalarCurveT(), {
          keys: [
            Object.assign(new FloatKeyT(), { time: 0, value: 0, interpolation: 1, outSlope: 4 }),
            Object.assign(new FloatKeyT(), { time: 0.75, value: 3, inSlope: 4 }),
          ],
        });
        document.animations.push(
          new AnimationT(
            10,
            'Timeline',
            0.75,
            false,
            [
              new TrackT(
                new BindingT(4, AnimationProperty.NodePosition),
                2,
                new Vector3TrackT(curve),
              ),
            ],
            [0, 0.1, 0.3, 0.6, 0.75].map((at) => new AnimationEventT(at, 'ReceiveTimelineEvent')),
          ),
        );
        const track = new TimelineTrackT(new SourceReferenceT('motion', 1n), 'animation', 2);
        track.target = new TypedReferenceT(2, 8);
        track.position = new Vec3T();
        track.eulerRadians = new Vec3T();
        track.trackOffset = 0;
        const clip = new TimelineClipT();
        clip.duration = 0.75;
        clip.preExtrapolation = 1;
        clip.postExtrapolation = 1;
        clip.dataType = 1;
        clip.data = new TimelineAnimationT(10, new Vec3T(), new Vec3T());
        track.clips = [clip];
        source.timeline!.tracks.push(track);
        source.timeline!.roots.push(1);
      });
      const sim = new Simulation(pack);
      let events = 0,
        eventX = 0;
      sim.onAnimationEvent = () => {
        events++;
        eventX = sim.scene.nodes.get(4)!.localPosition.x;
      };
      sim.play();
      const director = sim.getDirector(3),
        node = sim.scene.nodes.get(4)!;
      director.setTime(row.samples[0]!.time);
      if (row.clock !== 3) director.advance(0, 0);
      let maxTime = 0,
        states = 0,
        active = 0,
        eventDifferences = 0,
        maxPosition = 0,
        maxEventPosition = 0;
      for (let i = 1; i < row.samples.length; i++) {
        const clock = native.clocks[i]!,
          sample = row.samples[i]!;
        sim.update(clock.scaled, {
          unscaledDeltaSeconds: clock.unscaled,
        });
        maxTime = Math.max(maxTime, Math.abs(director.time - sample.time));
        states += Number((director.state === 'playing' ? 'Playing' : 'Paused') !== sample.state);
        active += Number(node.active !== sample.active);
        eventDifferences += Number(events !== sample.events);
        maxPosition = Math.max(maxPosition, Math.abs(node.localPosition.x - sample.x));
        maxEventPosition = Math.max(maxEventPosition, Math.abs(eventX - sample.eventX));
      }
      results.push({
        clock: row.clock,
        wrap: row.wrap,
        maxTime,
        states,
        active,
        eventDifferences,
        maxPosition,
        maxEventPosition,
      });
      sim.disposeDirectors();
      pack.dispose();
    }
    writeFileSync(directory + '/comparison.json', JSON.stringify(results, null, 2));
    expect(results.filter((r) => r.states || r.active || r.eventDifferences)).toEqual([]);
    expect(results.filter((r) => r.maxPosition > 1e-5 || r.maxEventPosition > 1e-5)).toEqual([]);
    expect(results.filter((r) => r.maxTime > 1e-5)).toEqual([]);
  },
);
