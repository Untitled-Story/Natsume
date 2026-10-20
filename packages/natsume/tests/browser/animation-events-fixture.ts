import { getPreview } from '../../../playground/src/preview.js';
import { EffectInstance } from '../../src/runtime/runtime.js';
import { Simulation } from '../../src/runtime/simulation.js';
import { eventPack } from '../event-pack.js';

export function verifyAnimationEvents() {
  const { runtime } = getPreview();
  if (!runtime) throw new Error('Missing runtime');
  const make = () => new EffectInstance(new Simulation(eventPack()), runtime, () => {}, {});
  const bridge = make();
  let bridgeCount = 0;
  const internals = bridge as unknown as {
    behaviors: { node: unknown; behavior: unknown; active: boolean; failed: boolean }[];
  };
  internals.behaviors.push({
    node: bridge.simulation.scene.nodes.get(1),
    behavior: {
      onAnimationEvent: () => {
        bridgeCount++;
        return true;
      },
    },
    active: false,
    failed: false,
  });
  bridge.play();
  bridge.update(0.25);
  const bridgeHandled = !bridge.diagnostics.some((d) => d.code === 'ANIMATION_EVENT_RECEIVER');
  bridge.destroy();
  const effect = make();
  const messages: string[] = [];
  let second = 0;
  const off = effect.onAnimationEvent((e) => {
    messages.push(e.stringParameter);
    return true;
  });
  effect.play();
  effect.update(0.25);
  off();
  off();
  effect.restart();
  const missing = effect.diagnostics.some((d) => d.code === 'ANIMATION_EVENT_RECEIVER');
  effect.onAnimationEvent(() => {
    throw new Error('event failure');
  });
  effect.onAnimationEvent(() => {
    second++;
    return true;
  });
  effect.restart();
  const isolated =
    effect.diagnostics.some((d) => d.code === 'ANIMATION_EVENT_ERROR') && second === 1;
  const recursive = make();
  let recursion = false;
  recursive.onAnimationEvent(() => {
    try {
      recursive.update(1 / 60);
    } catch {
      recursion = true;
    }
    return true;
  });
  recursive.play();
  const cancelled = make();
  const batch: string[] = [];
  cancelled.onAnimationEvent((e) => {
    batch.push(e.stringParameter);
    if (e.stringParameter === 'event-2') cancelled.stop('clear');
    return true;
  });
  cancelled.play();
  cancelled.update(0.25);
  cancelled.update(0.25);
  const destroyed = make();
  let later = 0;
  destroyed.onAnimationEvent(() => {
    destroyed.destroy();
    return true;
  });
  destroyed.onAnimationEvent(() => {
    later++;
  });
  destroyed.play();
  const result = {
    bridgeCount,
    bridgeHandled,
    messages,
    missing,
    isolated,
    recursion,
    batch,
    destroyed: destroyed.destroyed,
    later,
  };
  effect.destroy();
  recursive.destroy();
  cancelled.destroy();
  return result;
}
