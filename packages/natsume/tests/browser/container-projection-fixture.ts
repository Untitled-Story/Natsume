import { createPlaybackHarness } from './playback-harness.js';
import { minimalDocument } from '../helpers.js';
import { particleSource } from '../particle-fixtures.js';
import { EffectPack } from '../../src/pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { NodeT } from '../../src/format/generated/noa/ir/node.js';
import { TransformT } from '../../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../../src/format/generated/noa/ir/quaternion.js';

export async function verifyContainerProjection() {
  const { app, runtime } = await createPlaybackHarness();
  const document = minimalDocument();
  const transform = new TransformT(
    new Vec3T(2, 3, 4),
    new QuaternionT(0, 0, 0, 1),
    new Vec3T(1, 1, 1),
  );
  document.nodes.push(new NodeT(5, 'child', 1, true, transform));
  document.components = [
    new ComponentT(3, 5, true, ComponentData.ParticleSystem, particleSource()),
  ];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  try {
    const effect = await runtime.instantiate(pack, {
      particleEnvironment: { fog: { mode: 'none' } },
    });
    const child = effect.getNode(5)!;
    const before = {
      point: effect.worldToContainer([3, 4, 5]),
      child: child.containerPosition,
    };
    effect.setDisplayMatrix([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 0.001, 0, 10, 20, 0, 1]);
    const after = {
      point: effect.worldToContainer([3, 4, 5]),
      child: child.containerPosition,
      root: effect.getNode(1)!.containerPosition,
    };
    child.setRenderOffset({ x: 7, y: 7 });
    const withOffset = child.containerPosition;
    let rejected = 0;
    for (const point of [[NaN, 0, 0], [0, 0], 'abc'])
      try {
        effect.worldToContainer(point as never);
      } catch {
        rejected++;
      }
    return { before, after, withOffset, rejected };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}
