import { createPlaybackHarness } from './playback-harness.js';
import { minimalDocument } from '../helpers.js';
import { particleSource } from '../particle-fixtures.js';
import { EffectPack } from '../../src/pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { NodeT } from '../../src/format/generated/noa/ir/node.js';

export async function verifyInstanceInspection() {
  const { app, runtime } = await createPlaybackHarness();
  const document = minimalDocument();
  document.nodes.push(new NodeT(5, 'child', 1, true, document.nodes[0]!.transform));
  document.components = [
    new ComponentT(3, 5, true, ComponentData.ParticleSystem, particleSource()),
  ];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  try {
    const effect = await runtime.instantiate(pack, {
      particleEnvironment: { fog: { mode: 'none' } },
    });
    const result = {
      entry: effect.entry,
      nodes: effect.nodes.map((n) => [n.id, n.name, n.parent?.id ?? 0]),
      systems: effect.particleSystems,
    };
    effect.destroy();
    let destroyed = 0;
    for (const read of [() => effect.entry, () => effect.nodes, () => effect.particleSystems])
      try {
        read();
      } catch {
        destroyed++;
      }
    return { ...result, destroyed };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}
