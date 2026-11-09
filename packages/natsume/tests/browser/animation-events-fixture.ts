import { createPlaybackHarness } from './playback-harness.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { CustomComponentT } from '../../src/format/generated/noa/ir/custom-component.js';
import { ScriptIdentityT } from '../../src/format/generated/noa/ir/script-identity.js';
import { eventPack } from '../event-pack.js';

export async function verifyThrowingScriptLifecycle() {
  const { app, runtime } = await createPlaybackHarness('throw');
  const identity = new ScriptIdentityT('Tests', '', 'ThrowingLifecycle');
  const destroyed: number[] = [];
  let created = 0;
  runtime.registerScript(identity, () => {
    const id = ++created;
    return {
      onAnimationEvent() {
        throw new Error('event failure');
      },
      update() {
        throw new Error('update failure');
      },
      onDisable() {
        throw new Error('disable failure');
      },
      destroy() {
        destroyed.push(id);
        throw new Error('destroy failure');
      },
    };
  });
  const pack = eventPack((document) => {
    for (const id of [20, 21])
      document.components.push(
        new ComponentT(id, 1, true, ComponentData.CustomComponent, new CustomComponentT(identity)),
      );
  });
  try {
    const effect = await runtime.instantiate(pack);
    effect.play();
    const eventIsolated =
      effect.diagnostics.filter((d) => d.code === 'ANIMATION_EVENT_ERROR').length === 2;
    let updateThrown = false,
      destroyThrown = false;
    try {
      effect.update(1 / 60);
    } catch (error) {
      updateThrown = error instanceof Error && error.message === 'update failure';
    }
    effect.update(0); // The recursive-update guard must have been released.
    try {
      effect.destroy();
    } catch (error) {
      destroyThrown = error instanceof Error && error.message === 'disable failure';
    }
    runtime.destroy(); // The failed instance still released its runtime registration.
    return { eventIsolated, updateThrown, destroyThrown, destroyed, disposed: effect.destroyed };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyAnimationEvents() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = eventPack();
  const make = () => runtime.instantiate(pack);
  const identity = new ScriptIdentityT('Tests', '', 'EventReceiver');
  let bridgeCount = 0;
  runtime.registerScript(identity, () => ({
    onAnimationEvent: () => {
      bridgeCount++;
      return true;
    },
  }));
  const bridgePack = eventPack((document) => {
    document.components.push(
      new ComponentT(20, 1, true, ComponentData.CustomComponent, new CustomComponentT(identity)),
    );
  });
  const bridge = await runtime.instantiate(bridgePack);
  bridge.play();
  bridge.update(0.25);
  const bridgeHandled = !bridge.diagnostics.some((d) => d.code === 'ANIMATION_EVENT_RECEIVER');
  bridge.destroy();
  const effect = await make();
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
  const recursive = await make();
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
  const cancelled = await make();
  const batch: string[] = [];
  cancelled.onAnimationEvent((e) => {
    batch.push(e.stringParameter);
    if (e.stringParameter === 'event-2') cancelled.stop('clear');
    return true;
  });
  cancelled.play();
  cancelled.update(0.25);
  cancelled.update(0.25);
  const destroyed = await make();
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
  runtime.destroy();
  pack.dispose();
  bridgePack.dispose();
  app.destroy(true);
  return result;
}
