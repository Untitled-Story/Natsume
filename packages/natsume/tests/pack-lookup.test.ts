import { describe, expect, it } from 'vitest';
import { EffectPack } from '../src/index.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { CustomComponentT } from '../src/format/generated/noa/ir/custom-component.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { minimalDocument } from './helpers.js';

function pack() {
  const document = minimalDocument();
  document.nodes.push(
    new NodeT(3, 'Effect', 1),
    new NodeT(4, 'Spark', 3),
    new NodeT(5, 'Spark', 3),
    new NodeT(6, 'Spark', 1),
    new NodeT(7, 'root', 0),
    new NodeT(8, 'Effect', 7),
  );
  document.components = [
    new ComponentT(10, 4, true, ComponentData.Animator, new AnimatorT()),
    new ComponentT(11, 5, true, ComponentData.Animator, new AnimatorT()),
    new ComponentT(12, 5, true, ComponentData.CustomComponent, new CustomComponentT()),
  ];
  return new EffectPack(document, { files: [] } as never, new Map(), new Map());
}

describe('EffectPack lookups', () => {
  it('finds nodes by slash-separated root paths, returning every match', () => {
    const p = pack();
    expect(p.findNodesByPath('root/Effect/Spark').map((n) => n.id)).toEqual([4, 5]);
    expect(p.findNodesByPath('root/Effect').map((n) => n.id)).toEqual([3, 8]);
    expect(p.findNodesByPath('root/Spark').map((n) => n.id)).toEqual([6]);
    expect(p.findNodesByPath('Effect/Spark')).toEqual([]);
    expect(p.findNodesByPath('root/Missing')).toEqual([]);
  });
  it('filters components by type name and node with typed data', () => {
    const p = pack();
    expect(p.findComponents('Animator').map((c) => c.id)).toEqual([10, 11]);
    expect(p.findComponents('Animator', 5).map((c) => c.id)).toEqual([11]);
    const [script] = p.findComponents('CustomComponent');
    expect(script?.data).toBeInstanceOf(CustomComponentT);
    expect(p.findComponents('ParticleSystem')).toEqual([]);
  });
});
