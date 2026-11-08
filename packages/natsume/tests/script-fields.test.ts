import { expect, it } from 'vitest';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { animationSupport } from '../src/runtime/animation.js';
import { Scene } from '../src/runtime/scene.js';
import type { ScriptFieldResolver } from '../src/runtime/script-fields.js';
import { scriptFieldPack } from './script-field-fixtures.js';
import type { FloatTrackT } from '../src/format/generated/noa/ir/float-track.js';
import { EffectPack } from '../src/pack.js';
import type { DocumentT } from '../src/format/generated/noa/ir/document.js';
import { animatedScriptFieldValue } from '../src/runtime/script-fields.js';

const types = { mode: 'int', weight: 'float', visible: 'bool' } as const;
const resolve: ScriptFieldResolver = (_component, name) => types[name as keyof typeof types];
it.each([
  [-2.500001, -3],
  [-2.5, -3],
  [-2.499999, -2],
  [-1.5, -2],
  [-0.5000000596046448, -1],
  [-0.5, 0],
  [-0.4999999701976776, 0],
  [0.5, 1],
  [1.5, 2],
  [2.5, 3],
  [-15.5, -16],
])('matches native ordinary integer conversion %s → %s', (value, expected) => {
  expect(animatedScriptFieldValue('int', value)).toBe(expected);
});
it('preserves decoded integer precision above the Float32 exact integer range', () => {
  expect(animatedScriptFieldValue('int', 16777217, true)).toBe(16777217);
});
it.each([
  [-0.0010001, true],
  [-0.001, false],
  [-0.0001, false],
  [0, false],
  [0.001, false],
  [0.0010001, true],
] as const)('matches native boolean script threshold for %s', (value, expected) => {
  const original = scriptFieldPack();
  const doc = structuredClone(original.document) as DocumentT;
  const track = doc.animations[0]!.tracks[2]!;
  (track.data as FloatTrackT).curve!.keys[0]!.value = value;
  const pack = new EffectPack(doc, original.manifest, new Map(), new Map());
  const bindings = new AnimationBindings(pack, new Scene(pack, [1]), resolve);
  bindings.compile(track)!.sample(0);
  expect(bindings.scriptFields.get(4)!.visible).toBe(expected);
});
it('preflights every source field without running host code', () => {
  const pack = scriptFieldPack(),
    clip = pack.document.animations[0]!;
  expect(animationSupport(clip, pack).filter((i) => i.severity === 'error')).toHaveLength(3);
  expect(animationSupport(clip, pack, resolve)).toEqual([]);
  expect(animationSupport(clip, pack, () => 'bool').some((i) => i.severity === 'error')).toBe(true);
});
it('decodes integer bits only with source evidence and isolates/restarts declared fields', () => {
  const pack = scriptFieldPack(),
    a = new AnimationBindings(pack, new Scene(pack, [1]), resolve),
    b = new AnimationBindings(pack, new Scene(pack, [1]), resolve);
  for (const track of pack.document.animations[0]!.tracks) a.compile(track)!.sample(0);
  expect(a.scriptFields.get(4)).toEqual({ mode: 1, weight: 4, visible: false });
  expect(b.scriptFields.get(4)).toEqual({ mode: 0, weight: 2, visible: true });
  expect(a.pendingScriptFields.get(4)?.get('mode')).toBe(1);
  a.reset();
  expect(a.scriptFields.get(4)).toEqual({ mode: 0, weight: 2, visible: true });
  expect(pack.customComponents[0]!.data).toEqual(b.pack.customComponents[0]!.data);
});
