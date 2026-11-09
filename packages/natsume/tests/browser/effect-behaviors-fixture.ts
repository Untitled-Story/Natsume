import type { BehaviorHandle } from '../../src/index.js';
import { createPlaybackHarness } from './playback-harness.js';
import { eventPack } from '../event-pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { CustomComponentT } from '../../src/format/generated/noa/ir/custom-component.js';
import { ScriptIdentityT } from '../../src/format/generated/noa/ir/script-identity.js';
import { particleSource, constant } from '../particle-fixtures.js';
import { ParticleModuleT } from '../../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData } from '../../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../../src/format/generated/noa/ir/emission-module.js';

export async function verifyBehaviorPhases() {
  const { app, runtime } = await createPlaybackHarness();
  const identity = new ScriptIdentityT('Tests', '', 'Phases');
  const calls: string[] = [];
  runtime.registerScript(identity, () => ({
    beforeUpdate: () => calls.push('script:before'),
    update: () => calls.push('script:update'),
    lateUpdate: () => calls.push('script:late'),
  }));
  const pack = eventPack((d) =>
    d.components.push(
      new ComponentT(20, 1, true, ComponentData.CustomComponent, new CustomComponentT(identity)),
    ),
  );
  try {
    const effect = await runtime.instantiate(pack);
    const times: number[] = [];
    const deltas: number[] = [];
    const handle = effect.addBehavior(({ effect: instance }) => ({
      onEnable: () => calls.push('enable'),
      beforeUpdate(dt) {
        calls.push('before');
        times.push(instance.time);
        deltas.push(dt);
      },
      update(dt) {
        calls.push('update');
        times.push(instance.time);
        deltas.push(dt);
      },
      lateUpdate(dt) {
        calls.push('late');
        times.push(instance.time);
        deltas.push(dt);
        instance.getNode(1)!.setRenderOffset({ x: 12, y: 34 });
      },
      onDisable: () => calls.push('disable'),
      destroy: () => calls.push('destroy'),
    }));
    effect.play();
    calls.length = 0;
    effect.onAnimationEvent(() => {
      calls.push('animation');
      return true;
    });
    effect.update(0.15);
    const frame = [...calls];
    const offset = effect.getNode(1)!.renderOffset;
    calls.length = 0;
    effect.pause();
    effect.update(0.1);
    effect.update(0);
    const paused = [...calls];
    effect.restart();
    const retained = !handle.removed;
    calls.length = 0;
    handle.setEnabled(false);
    handle.setEnabled(false);
    effect.update(1 / 60);
    const disabledHostUpdates = calls.filter((c) => ['before', 'update', 'late'].includes(c));
    handle.setEnabled(true);
    handle.remove();
    handle.remove();
    effect.destroy();
    return {
      frame,
      times,
      deltas,
      offset,
      paused,
      retained,
      disabledHostUpdates,
      cleanup: calls.filter((c) => ['disable', 'enable', 'destroy'].includes(c)),
      removed: handle.removed,
      enabled: handle.enabled,
    };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyBehaviorMutation() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = eventPack();
  try {
    const effect = await runtime.instantiate(pack);
    const calls: string[] = [];
    let added = false;
    effect.addBehavior(() => ({
      beforeUpdate() {
        calls.push('first:before');
        second.remove();
        if (!added) {
          added = true;
          effect.addBehavior(() => ({
            beforeUpdate: () => calls.push('new:before'),
            update: () => calls.push('new:update'),
            lateUpdate: () => calls.push('new:late'),
          }));
        }
      },
      lateUpdate: () => calls.push('first:late'),
    }));
    const second: BehaviorHandle = effect.addBehavior(() => ({
      beforeUpdate: () => calls.push('removed:before'),
      lateUpdate: () => calls.push('removed:late'),
      destroy: () => calls.push('removed:destroy'),
    }));
    effect.play();
    calls.length = 0;
    effect.update(1 / 60);
    const first = [...calls];
    calls.length = 0;
    effect.update(1 / 60);
    return { first, next: calls };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyBehaviorCancellation(action: 'pause' | 'restart' | 'destroy') {
  const { app, runtime } = await createPlaybackHarness();
  const pack = eventPack();
  try {
    const effect = await runtime.instantiate(pack);
    const calls: string[] = [];
    effect.addBehavior(() => ({
      beforeUpdate() {
        calls.push('before');
        effect[action]();
      },
      update: () => calls.push('update'),
      lateUpdate: () => calls.push('late'),
    }));
    effect.addBehavior(() => ({ beforeUpdate: () => calls.push('other') }));
    effect.play();
    effect.update(1 / 60);
    return { calls, time: effect.time };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyBehaviorErrors(policy: 'isolate' | 'throw') {
  const { app, runtime } = await createPlaybackHarness(policy);
  const pack = eventPack();
  try {
    const effect = await runtime.instantiate(pack);
    const calls: string[] = [];
    let failures = 0;
    const bad = effect.addBehavior(() => ({
      beforeUpdate() {
        calls.push('failure');
        if (++failures === 1) throw new Error('before failure');
      },
      lateUpdate: () => calls.push('bad:late'),
      destroy() {
        calls.push('bad:destroy');
        throw new Error('destroy failure');
      },
    }));
    const good = effect.addBehavior(() => ({
      beforeUpdate: () => calls.push('good:before'),
      lateUpdate: () => calls.push('good:late'),
      onDisable() {
        calls.push('good:disable');
        throw new Error('disable failure');
      },
      destroy: () => calls.push('good:destroy'),
    }));
    effect.play();
    const errors: string[] = [];
    try {
      effect.update(1 / 60);
    } catch (error) {
      errors.push((error as Error).message);
    }
    effect.update(1 / 60); // Isolate skips the receiver; throw allows the host to retry.
    try {
      effect.destroy();
    } catch (error) {
      errors.push((error as Error).message);
    }
    return {
      calls,
      errors,
      removed: bad.removed && good.removed,
      diagnostics: effect.diagnostics.filter((d) => d.code === 'SCRIPT_ERROR').length,
    };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyBehaviorGuards() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = eventPack();
  try {
    const effect = await runtime.instantiate(pack);
    const errors: string[] = [];
    const caught = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        errors.push((error as Error).message);
      }
    };
    let frames = 0;
    const handle = effect.addBehavior(() => ({
      beforeUpdate() {
        frames++;
        caught(() => effect.update(0));
      },
    }));
    effect.play();
    caught(() => effect.update(-1));
    caught(() => effect.update(NaN));
    effect.update(0);
    effect.update(1 / 60);
    handle.remove();
    caught(() => handle.setEnabled(true));
    effect.destroy();
    caught(() => effect.addBehavior(() => ({})));
    return { frames, errors };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

export async function verifyBehaviorFrameClocks() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = eventPack((d) => {
    const source = particleSource();
    source.modules.push(
      new ParticleModuleT(
        ParticleModuleData.EmissionModule,
        new EmissionModuleT(constant(60), constant(0), []),
      ),
    );
    d.components.push(new ComponentT(30, 1, true, ComponentData.ParticleSystem, source));
  });
  try {
    const effect = await runtime.instantiate(pack);
    const calls: string[] = [];
    effect.addBehavior(() => ({
      beforeUpdate: () => calls.push('before'),
      update: () => calls.push('update'),
      lateUpdate: () => calls.push('late'),
    }));
    effect.update(1 / 60);
    const idle = [...calls];
    effect.play();
    effect.update(1 / 120);
    const substep = [...calls];
    calls.length = 0;
    effect.update(1 / 120);
    const step = [...calls];
    calls.length = 0;
    effect.stop('drain');
    effect.update(1 / 60);
    const drain = [...calls];
    calls.length = 0;
    effect.stop('clear');
    effect.update(1 / 60);
    const stopped = [...calls];
    return { idle, substep, step, drain, stopped };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}
