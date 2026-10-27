import { expect, it } from 'vitest';
import {
  advanceLifetimeProgress,
  lifetimeProgressAge,
  reciprocalLifetime,
} from '../src/runtime/particle-clock.js';
import { readNativeFixture } from './native-fixture.js';

interface Observation {
  rootLifetime: number;
  childLifetime: number;
  firstEvent: number;
  warm: boolean;
  delay: boolean;
  samples: { child: { seed: number; age: number; lifetime: number }[] }[];
}

const native: { cases: Observation[] } = JSON.parse(
  readNativeFixture('unity-sub-emitter-playback.json'),
);

it('retains exact percentage endpoints and distinguishes the following step', () => {
  expect(advanceLifetimeProgress(0, 0.25, 1)).toBe(25);
  expect(lifetimeProgressAge(100, 1)).toBe(1);
  expect(advanceLifetimeProgress(100, 1 / 60, 1)).toBeGreaterThan(100);
});

for (const c of native.cases.filter((c) => c.warm && !c.delay && c.firstEvent === 2))
  it(`matches player-loop lifetime progression from zero age (${c.rootLifetime}/${c.childLifetime})`, () => {
    const initial = c.samples[0]!.child.find((p) => p.age === 0);
    if (!initial) return;
    const inverse = reciprocalLifetime(c.childLifetime);
    expect(Math.fround(1 / inverse)).toBe(initial.lifetime);
    let progress = 0;
    for (let frame = 1; frame < c.samples.length; frame++) {
      progress = advanceLifetimeProgress(progress, Math.fround(1 / 60), inverse);
      const actual = c.samples[frame]!.child.find((p) => p.seed === initial.seed);
      if (!actual) {
        expect(progress).toBeGreaterThan(100);
        break;
      }
      expect(lifetimeProgressAge(progress, initial.lifetime)).toBe(actual.age);
    }
  });
