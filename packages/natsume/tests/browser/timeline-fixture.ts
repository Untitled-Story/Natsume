import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../../src/format/generated/noa/ir/component-data.js';
import { CustomComponentT } from '../../src/format/generated/noa/ir/custom-component.js';
import { ScriptIdentityT } from '../../src/format/generated/noa/ir/script-identity.js';
import { TimelineControlT } from '../../src/format/generated/noa/ir/timeline-control.js';
import { TypedReferenceT } from '../../src/format/generated/noa/ir/typed-reference.js';
import { timelinePack } from '../timeline-pack.js';
import { createPlaybackHarness } from './playback-harness.js';

export async function verifyDirectors() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = timelinePack();
  try {
    const a = await runtime.instantiate(pack),
      b = await runtime.instantiate(pack);
    const handle = a.getDirector(3);
    a.play();
    b.play();
    handle.setTime(0.5);
    handle.evaluate();
    const live = a.getNode(4)!.active;
    const other = b.getDirector(3);
    other.setTime(0);
    other.evaluate();
    const isolated = a.getNode(4)!.active && !b.getNode(4)!.active;
    handle.setBinding({ guid: 'track', fileId: 0n }, { nodeId: 5 });
    handle.setTime(0);
    handle.evaluate();
    const rebound = a.getNode(4)!.active && !a.getNode(5)!.active;
    a.restart();
    const retained = a.getDirector(3) === handle;
    a.destroy();
    let disposed = false;
    try {
      handle.evaluate();
    } catch {
      disposed = true;
    }
    b.destroy();
    return { live, isolated, rebound, retained, disposed };
  } finally {
    runtime.destroy();
    app.destroy(true);
    pack.dispose();
  }
}

export async function verifyControlCancellation() {
  const { app, runtime } = await createPlaybackHarness();
  const calls: string[] = [];
  const identities = ['first', 'second'].map((name) => {
    const identity = new ScriptIdentityT('Tests', '', name);
    runtime.registerScript(identity, ({ effect }) => ({
      onControlTimeStart() {
        calls.push(name + ':start');
        if (name === 'first') effect.getDirector(3).stop();
      },
      onControlTime() {
        calls.push(name + ':sample');
      },
      onControlTimeStop() {
        calls.push(name + ':stop');
      },
    }));
    return identity;
  });
  const pack = timelinePack((source, document) => {
    document.components.push(
      ...identities.map(
        (identity, index) =>
          new ComponentT(20 + index, 4, true, C.CustomComponent, new CustomComponentT(identity)),
      ),
    );
    const track = source.timeline!.tracks[0]!;
    track.kind = 3;
    track.target = null;
    track.clips[0]!.dataType = 2;
    track.clips[0]!.data = new TimelineControlT(
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
  try {
    const effect = await runtime.instantiate(pack);
    const director = effect.getDirector(3);
    director.setTime(0.5);
    director.evaluate();
    effect.update(0);
    effect.destroy();
    return calls;
  } finally {
    runtime.destroy();
    app.destroy(true);
    pack.dispose();
  }
}

export async function verifyDisabledControlReceiver() {
  const { app, runtime } = await createPlaybackHarness();
  const identity = new ScriptIdentityT('Assembly-CSharp', 'Probe', 'DisabledControl');
  const calls: string[] = [];
  runtime.registerScript(identity, () => ({
    onEnable() {
      calls.push('enable');
    },
    update() {
      calls.push('update');
    },
    onControlTimeStart() {
      calls.push('start');
    },
    onControlTime() {
      calls.push('sample');
    },
    onControlTimeStop() {
      calls.push('stop');
    },
  }));
  const pack = timelinePack((source, document) => {
    const track = source.timeline!.tracks[0]!;
    track.kind = 3;
    track.target = null;
    track.clips[0]!.dataType = 2;
    track.clips[0]!.data = new TimelineControlT(
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
    document.components.push(
      new ComponentT(7, 4, false, C.CustomComponent, new CustomComponentT(identity)),
    );
  });
  try {
    const effect = await runtime.instantiate(pack);
    effect.play();
    const director = effect.getDirector(3);
    director.setTime(0.5);
    director.evaluate();
    director.stop();
    effect.update(1 / 60);
    effect.destroy();
    return calls;
  } finally {
    runtime.destroy();
    app.destroy(true);
    pack.dispose();
  }
}
