import { EffectPack } from '../src/pack.js';
import type { DocumentT } from '../src/format/generated/noa/ir/document.js';
import { expect, it } from 'vitest';
import { AnimationClock } from '../src/runtime/animation.js';
import { visitAnimationEvents } from '../src/runtime/animation-events.js';
import { AnimationEventT } from '../src/format/generated/noa/ir/animation-event.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

interface Case {
  duration: number;
  dt: number;
  speed: number;
  offset: number;
  loop: boolean;
  lifecycle: number;
  hits: { frame: number; name: string; time: number; x: number }[];
}
const native: { cases: Case[] } = JSON.parse(readNativeFixture('unity-events.json'));

it('matches native event endpoints, cycles and source order', () => {
  let mismatches = 0;
  const examples = [];
  for (const [index, c] of native.cases.entries()) {
    if (c.lifecycle || c.dt > 0.25) continue;
    const events = [0, 0.25, 0.5, 0.5, 1].map(
      (t, i) => new AnimationEventT(Math.fround(c.duration * t), 'Receive', 'event-' + i),
    );
    const clock = new AnimationClock(c.duration, c.loop, c.speed, c.offset);
    const offset = c.loop ? Math.fround(c.offset) : 0;
    let cursor = (offset === 1 ? 0 : offset) - Number.EPSILON;
    const hits: { frame: number; name: string }[] = [];
    const collect = (frame: number, to: number) => {
      visitAnimationEvents(events, c.duration, c.loop, cursor, to, (e) => {
        hits.push({ frame, name: String(e.stringParameter) });
        return true;
      });
      cursor = to;
    };
    collect(-1, offset === 1 ? 0 : offset);
    cursor = offset;
    for (let frame = 0; frame < 32; frame++) {
      clock.advance(c.dt);
      collect(frame, Math.fround(clock.normalizedTime + offset));
    }
    if (
      JSON.stringify(hits) !== JSON.stringify(c.hits.map((h) => ({ frame: h.frame, name: h.name })))
    ) {
      mismatches++;
      if (examples.length < 6)
        examples.push({
          index,
          duration: c.duration,
          dt: c.dt,
          speed: c.speed,
          offset: c.offset,
          first: hits.findIndex(
            (h, i) =>
              JSON.stringify(h) !==
              JSON.stringify(c.hits[i] && { frame: c.hits[i]!.frame, name: c.hits[i]!.name }),
          ),
          counts: [hits.length, c.hits.length],
        });
    }
    recordError(
      'animation.events.sequence',
      JSON.stringify(hits) === JSON.stringify(c.hits.map((h) => ({ frame: h.frame, name: h.name })))
        ? 0
        : 1,
      'mismatches',
      String(index),
    );
  }
  if (mismatches) console.log('event differences', mismatches, JSON.stringify(examples));
  expect(mismatches).toBe(0);
});

it('cancels a crossed-cycle batch immediately', () => {
  const events = [new AnimationEventT(0, 'zero'), new AnimationEventT(1, 'end')];
  const names: string[] = [];
  visitAnimationEvents(events, 1, true, -Number.EPSILON, 3, (e) => {
    names.push(String(e.name));
    return names.length < 2;
  });
  expect(names).toEqual(['zero', 'end']);
});

it('defers a replacement state initial event and cancels the old fixed step', () => {
  for (const restart of [false, true]) {
    const pack = eventPack();
    const s = new Simulation(pack);
    const names: string[] = [];
    let replaced = false;
    s.onAnimationEvent = (e) => {
      names.push(e.stringParameter);
      if (!replaced && e.stringParameter === 'event-2') {
        replaced = true;
        if (restart) s.restart();
        else s.applyAnimatorState(3, 4);
      }
    };
    s.play();
    for (let i = 0; i < 15; i++) s.update(1 / 60);
    expect(names).toEqual(['event-0', 'event-1', 'event-2']);
    const before = s.time;
    s.update(1 / 60);
    expect(names).toEqual(['event-0', 'event-1', 'event-2', 'event-0']);
    expect(s.time - before).toBeCloseTo(1 / 60);
    pack.dispose();
  }
});

import { eventPack } from './event-pack.js';
import { Simulation } from '../src/runtime/simulation.js';

it('preserves pause, restart, stop, overload and callback cancellation', () => {
  const pack = eventPack();
  const s = new Simulation(pack);
  let names: string[] = [];
  s.onAnimationEvent = (e) => {
    names.push(e.stringParameter);
  };
  s.play();
  expect(names).toEqual(['event-0']);
  s.update(0.125);
  expect(names).toEqual(['event-0']);
  s.pause();
  s.update(1);
  expect(names.length).toBe(1);
  s.play();
  s.update(1 / 60);
  expect(names.at(-1)).toBe('event-1');
  s.restart();
  names = [];
  s.update(1);
  expect(s.droppedSeconds).toBeGreaterThan(0.8);
  expect(names).toEqual(['event-1']);
  s.stop('clear');
  s.update(1);
  expect(names).toEqual(['event-1']);
  s.restart();
  names = [];
  s.onAnimationEvent = (e) => {
    names.push(e.stringParameter);
    if (e.stringParameter === 'event-2') s.stop('clear');
  };
  for (let i = 0; i < 20; i++) s.update(1 / 60);
  expect(names).toEqual(['event-1', 'event-2']);
  s.onAnimationEvent = (e) => {
    if (e.stringParameter === 'event-0') return;
    expect(() => s.update(1 / 60)).toThrow('Recursive');
  };
  s.restart();
  s.update(0.25);
  pack.dispose();
});

it('matches native disable and restart event sequences', () => {
  for (const c of native.cases.filter((c) => c.lifecycle)) {
    const pack = eventPack();
    const sim = new Simulation(pack);
    const hits: { frame: number; name: string }[] = [];
    let frame = -1;
    sim.onAnimationEvent = (e) => {
      hits.push({ frame, name: e.stringParameter });
    };
    sim.play();
    for (frame = 0; frame < 32; frame++) {
      if (c.lifecycle === 1 && frame === 8) sim.bindings.enabled.set(3, false);
      if (c.lifecycle === 1 && frame === 12) sim.bindings.enabled.set(3, true);
      if (c.lifecycle === 2 && frame === 8) sim.setNodeActive(1, false);
      if (c.lifecycle === 2 && frame === 12) sim.setNodeActive(1, true);
      if (c.lifecycle === 3 && frame === 8) sim.applyAnimatorState(3, 4);
      sim.update(1 / 60);
    }
    expect(hits).toEqual(c.hits.map((h) => ({ frame: h.frame, name: h.name })));
    pack.dispose();
  }
});

it('preserves typed payloads and rejects malformed source event contracts', async () => {
  const { validateDocument } = await import('../src/format/semantics.js');
  const { FeatureRequirementT } =
    await import('../src/format/generated/noa/ir/feature-requirement.js');
  const { ReferenceValueT } = await import('../src/format/generated/noa/ir/reference-value.js');
  const { SourceReferenceT } = await import('../src/format/generated/noa/ir/source-reference.js');
  const { TypedReferenceT } = await import('../src/format/generated/noa/ir/typed-reference.js');
  const pack = eventPack();
  const d = structuredClone(pack.document) as DocumentT;
  d.features = [
    new FeatureRequirementT('animation.events-typed', 1, true),
    new FeatureRequirementT('animator.single-layer', 1, true),
  ];
  const event = d.animations[0]!.events[0]!;
  event.stringParameter = '001';
  event.objectParameter = new ReferenceValueT(
    new SourceReferenceT('0123456789abcdef0123456789abcdef', 9007199254740993n),
    new TypedReferenceT(1, 1),
  );
  validateDocument(d);
  const p = new EffectPack(d, pack.manifest, new Map(), new Map());
  const s = new Simulation(p);
  let value: unknown;
  s.onAnimationEvent = (e) => {
    value = e;
  };
  s.play();
  expect(value).toMatchObject({
    stringParameter: '001',
    floatParameter: 1.25,
    intParameter: -2,
    objectParameter: { source: { fileId: 9007199254740993n }, target: { kind: 1, id: 1 } },
  });
  const invalid = structuredClone(d);
  const invalidEvent = invalid.animations[0]!.events[0]!;
  invalidEvent.timeSeconds = 2;
  expect(() => validateDocument(invalid)).toThrow('event time');
  invalidEvent.timeSeconds = 0;
  invalidEvent.objectParameter!.target = null;
  expect(() => validateDocument(invalid)).toThrow('Unresolved');
  pack.dispose();
  p.dispose();
});
