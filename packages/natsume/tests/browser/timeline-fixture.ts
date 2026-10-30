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
