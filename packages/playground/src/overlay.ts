import type { EffectInstance, NatsumeNode, RenderOffset } from 'natsume';

/** Preview hypothesis: render each outermost visible emitter at its parent's origin.
 * Particle state, nested pair offsets and clip depth remain authored values.
 * This is not a recovered game behavior or part of Natsume's playback rules.
 */
export class OverlayView {
  private readonly groups = new Map<number, NatsumeNode>();
  constructor(private readonly effect: EffectInstance) {
    const nodes = effect.renderedNodes;
    const rendered = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      let group = node;
      for (let parent = node.parent; parent; parent = parent.parent)
        if (rendered.has(parent.id)) group = parent;
      this.groups.set(group.id, group);
    }
  }
  offset(node: NatsumeNode): RenderOffset {
    let group: NatsumeNode | undefined;
    for (let current: NatsumeNode | undefined = node; current; current = current.parent) {
      group = this.groups.get(current.id);
      if (group) break;
    }
    if (!group?.parent) return { x: 0, y: 0 };
    const world = group.worldMatrix,
      parent = group.parent.worldMatrix;
    const x = world[12]! - parent[12]!,
      y = world[13]! - parent[13]!,
      z = world[14]! - parent[14]!;
    const matrix = this.effect.displayMatrix;
    return {
      x: -(matrix[0]! * x + matrix[4]! * y + matrix[8]! * z),
      y: -(matrix[1]! * x + matrix[5]! * y + matrix[9]! * z),
    };
  }
  apply(enabled: boolean): void {
    for (const group of this.groups.values())
      group.setRenderOffset(enabled ? this.offset(group) : null);
  }
}
