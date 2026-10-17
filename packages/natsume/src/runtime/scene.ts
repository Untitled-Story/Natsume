import { mat4, quat } from 'gl-matrix';
import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { NodeT } from '../format/generated/noa/ir/node.js';
import type { RectLayoutT } from '../format/generated/noa/ir/rect-layout.js';
import { ComponentData } from '../format/generated/noa/ir/component-data.js';

export interface LayoutSize {
  readonly width: number;
  readonly height: number;
}
export class SceneNode {
  readonly id: number;
  readonly name: string;
  readonly localMatrix = mat4.create();
  readonly worldMatrix = mat4.create();
  readonly worldRotation = quat.create();
  renderOffsetX = 0;
  renderOffsetY = 0;
  inheritedRenderOffsetX = 0;
  inheritedRenderOffsetY = 0;
  active: boolean;
  activeInHierarchy = true;
  layout: LayoutSize | undefined;
  constructor(
    readonly source: R<NodeT>,
    readonly parent: SceneNode | undefined,
    readonly rect: R<RectLayoutT> | undefined,
  ) {
    this.id = source.id;
    this.name = String(source.name);
    this.active = source.active;
  }
}

/** Unity-space hierarchy. The instance root is an origin; its external anchor is host-owned. */
export class Scene {
  readonly nodes = new Map<number, SceneNode>();
  readonly ordered: SceneNode[] = [];
  readonly layoutSize: LayoutSize | undefined;
  constructor(pack: EffectPack, roots: readonly number[], hostLayout?: LayoutSize) {
    const rects = new Map(
      pack.components
        .filter((c) => c.dataType === ComponentData.RectLayout)
        .map((c) => [c.nodeId, c.data as R<RectLayoutT>]),
    );
    const children = new Map<number, R<NodeT>[]>();
    for (const n of pack.nodes) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
    const queue = roots.map((id) => {
      const n = pack.getNode(id);
      check(n, 'SEMANTIC', 'Missing entry root');
      return n;
    });
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]!,
        parent = this.nodes.get(n.parentId),
        node = new SceneNode(n, parent, rects.get(n.id));
      check(!this.nodes.has(n.id), 'CAPABILITY', 'Overlapping entry roots are unsupported');
      this.nodes.set(n.id, node);
      this.ordered.push(node);
      queue.push(...(children.get(n.id) ?? []));
      const tr = n.transform!,
        p = tr.position,
        q = tr.rotation,
        s = tr.scale;
      let x = p?.x ?? 0,
        y = p?.y ?? 0,
        z = p?.z ?? 0;
      const rect = node.rect;
      if (rect) {
        const min = rect.anchorMin!,
          max = rect.anchorMax!,
          pivot = rect.pivot!,
          delta = rect.sizeDelta!,
          pos = rect.anchoredPosition!;
        const parentSize = parent?.layout ?? hostLayout;
        const stretchX = max.x - min.x,
          stretchY = max.y - min.y;
        check(
          parentSize || (!stretchX && !stretchY),
          'HOST',
          `Node ${n.id} requires an external parent layout size`,
        );
        node.layout = Object.freeze({
          width: (parentSize?.width ?? 0) * stretchX + delta.x,
          height: (parentSize?.height ?? 0) * stretchY + delta.y,
        });
        check(
          node.layout.width >= 0 && node.layout.height >= 0,
          'HOST',
          'Layout has negative dimensions',
        );
        if (parent) {
          const pp = parent.rect?.pivot ?? { x: 0.5, y: 0.5 };
          x = (parentSize?.width ?? 0) * (min.x + stretchX * pivot.x - pp.x) + pos.x;
          y = (parentSize?.height ?? 0) * (min.y + stretchY * pivot.y - pp.y) + pos.y;
          z = pos.z;
        } else {
          x = pos.x;
          y = pos.y;
          z = pos.z;
        }
      }
      mat4.fromRotationTranslationScale(
        node.localMatrix,
        [q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1],
        [x, y, z],
        [s?.x ?? 1, s?.y ?? 1, s?.z ?? 1],
      );
    }
    if (roots.length === 1) this.layoutSize = this.nodes.get(roots[0]!)?.layout;
    this.update();
  }
  update(): void {
    for (const n of this.ordered) {
      n.activeInHierarchy = n.active && (n.parent?.activeInHierarchy ?? true);
      const q = n.source.transform!.rotation!;
      quat.set(n.worldRotation, q.x, q.y, q.z, q.w);
      if (n.parent) quat.multiply(n.worldRotation, n.parent.worldRotation, n.worldRotation);
      if (n.parent) mat4.multiply(n.worldMatrix, n.parent.worldMatrix, n.localMatrix);
      else mat4.copy(n.worldMatrix, n.localMatrix);
    }
  }
}
