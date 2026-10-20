import { minimalDocument } from './helpers.js';
import { EffectPack } from '../src/pack.js';
import { AnimationEventT } from '../src/format/generated/noa/ir/animation-event.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';

export function eventPack() {
  const d = minimalDocument();
  const clip = new AnimationT();
  clip.id = 10;
  clip.durationSeconds = 0.5;
  clip.loop = true;
  clip.events = [0, 0.125, 0.25, 0.25, 0.5].map((t, i) => {
    const e = new AnimationEventT(t, 'Receive', 'event-' + i, 1.25 + i, i - 2);
    e.animatorComponentId = 3;
    return e;
  });
  const animator = new AnimatorT();
  const layer = new AnimatorLayerT();
  layer.name = 'Base';
  layer.defaultStateId = 4;
  const state = new AnimatorStateT();
  state.id = 4;
  state.name = 'Probe';
  state.animationId = 10;
  state.speed = 1;
  layer.states = [state];
  animator.layers = [layer];
  d.animations = [clip];
  d.components = [new ComponentT(3, 1, true, ComponentData.Animator, animator)];
  return new EffectPack(d, { document: 'scene.noir', files: [] } as never, new Map(), new Map());
}
