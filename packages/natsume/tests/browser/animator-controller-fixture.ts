import type { DocumentT } from '../../src/format/generated/noa/ir/document.js';
import { createPlaybackHarness } from './playback-harness.js';
import { eventPack } from '../event-pack.js';
import { EffectPack } from '../../src/pack.js';
import { AnimatorT } from '../../src/format/generated/noa/ir/animator.js';
import { AnimatorStateT } from '../../src/format/generated/noa/ir/animator-state.js';
import { AnimatorLayerT } from '../../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorParameterT } from '../../src/format/generated/noa/ir/animator-parameter.js';
import { AnimatorParameterType } from '../../src/format/generated/noa/ir/animator-parameter-type.js';
import { AnimatorConditionT } from '../../src/format/generated/noa/ir/animator-condition.js';
import { AnimatorTransitionT } from '../../src/format/generated/noa/ir/animator-transition.js';
import { AnimationT } from '../../src/format/generated/noa/ir/animation.js';
import { AnimationEventT } from '../../src/format/generated/noa/ir/animation-event.js';

export async function verifyAnimatorControllers() {
  const { app, runtime } = await createPlaybackHarness();
  const template = eventPack();
  const document = structuredClone(template.document) as DocumentT;
  const source = document.components[0]!.data as AnimatorT;
  source.parameters = [new AnimatorParameterT('go', AnimatorParameterType.Trigger)];
  const transition = new AnimatorTransitionT();
  transition.destinationStateId = 5;
  transition.conditions = [new AnimatorConditionT('go')];
  source.layers[0]!.states[0]!.transitions = [transition];
  source.layers[0]!.states.push(new AnimatorStateT(5, 'Next', 11));
  source.layers.push(new AnimatorLayerT('Empty'));
  document.animations.push(
    new AnimationT(11, 'Next', 1, false, [], [new AnimationEventT(0, 'arrived')]),
  );
  const pack = new EffectPack(document, template.manifest, new Map(), new Map());
  try {
    const compatibility = runtime.checkCompatibility(pack);
    const first = await runtime.instantiate(pack),
      second = await runtime.instantiate(pack);
    const a = first.getAnimator(3),
      b = second.getAnimator(3);
    const hits: string[] = [];
    first.onAnimationEvent((event) => {
      hits.push(event.name);
      return true;
    });
    second.onAnimationEvent(() => true);
    first.play();
    second.play();
    a.setTrigger('go');
    first.update(1 / 60);
    second.update(1 / 60);
    const independent =
      a.getCurrentState()!.name === 'Next' && b.getCurrentState()!.name === 'Probe';
    const empty = a.getCurrentState(1) === undefined;
    first.playAnimatorState(3, 'Probe', 0);
    const replayed = a.getCurrentState()!.normalizedTime === 0;
    first.restart();
    const reset = a.getCurrentState()!.name === 'Probe';
    first.destroy();
    let disposed = false;
    try {
      a.setTrigger('go');
    } catch {
      disposed = true;
    }
    second.destroy();
    return {
      compatible: compatibility.compatible,
      independent,
      empty,
      replayed,
      reset,
      disposed,
      arrived: hits.includes('arrived'),
    };
  } finally {
    runtime.destroy();
    app.destroy(true);
    pack.dispose();
    template.dispose();
  }
}
