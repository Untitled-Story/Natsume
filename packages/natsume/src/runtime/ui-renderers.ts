import { canvasSortingRank } from '../rendering/canvas-sorting.js';
import { pixelAdjustedRect } from '../rendering/pixel-adjustment.js';
import { mat4, vec3 } from 'gl-matrix';
import { Texture } from 'pixi.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { Simulation } from './simulation.js';
import type { SceneNode } from './scene.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import type { UIImageT } from '../format/generated/noa/ir/uiimage.js';
import type { UIMaskT } from '../format/generated/noa/ir/uimask.js';
import type { CanvasGroupT } from '../format/generated/noa/ir/canvas-group.js';
import type { CanvasRendererT } from '../format/generated/noa/ir/canvas-renderer.js';
import type { RectMask2DT } from '../format/generated/noa/ir/rect-mask2-d.js';
import { MaterialT } from '../format/generated/noa/ir/material.js';
import { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import { RenderStateT } from '../format/generated/noa/ir/render-state.js';
import { StencilStateT } from '../format/generated/noa/ir/stencil-state.js';
import { StencilFaceT } from '../format/generated/noa/ir/stencil-face.js';
import { SceneMesh } from '../rendering/scene-mesh.js';
import { imageGeometry } from '../rendering/image-geometry.js';
import { spriteMaterial } from '../rendering/sprite-material.js';
import { spriteTextureKey } from '../rendering/sprite-texture.js';
import { check } from '../errors.js';

type Acquire = (material: R<MaterialT>, key?: number | string) => Promise<Texture>;
/** Native Graphic state remains per instance; resource leases belong to the runtime. */
export async function createUIRenderers(
  pack: EffectPack,
  simulation: Simulation,
  acquire: Acquire,
): Promise<SceneMesh[]> {
  const scene = simulation.scene,
    enabled = simulation.bindings.enabled;
  const images = pack.components.filter(
    (c) => c.dataType === C.UIImage && scene.nodes.has(c.nodeId),
  );
  const masks = pack.components.filter((c) => c.dataType === C.UIMask && scene.nodes.has(c.nodeId));
  const rectMasks = pack.components.filter(
    (c) => c.dataType === C.RectMask2D && scene.nodes.has(c.nodeId),
  );
  const groups = pack.components.filter(
    (c) => c.dataType === C.CanvasGroup && scene.nodes.has(c.nodeId),
  );
  const canvasRenderers = pack.components.filter(
    (c) => c.dataType === C.CanvasRenderer && scene.nodes.has(c.nodeId),
  );
  const sequence = new Map<number, { enter: number; exit: number }>();
  let serial = 0;
  const children = new Map<number, SceneNode[]>();
  for (const n of scene.ordered) {
    const key = n.parent?.id ?? 0;
    const list = children.get(key) ?? [];
    list.push(n);
    children.set(key, list);
  }
  const stack = (children.get(0) ?? [])
    .slice()
    .reverse()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) {
      sequence.get(item.node.id)!.exit = serial++;
      continue;
    }
    sequence.set(item.node.id, { enter: serial++, exit: 0 });
    stack.push({ ...item, exit: true });
    for (const node of (children.get(item.node.id) ?? []).slice().reverse())
      stack.push({ node, exit: false });
  }
  const result: SceneMesh[] = [];
  // Sprite silhouettes own bit zero; UI nesting uses the remaining bits.
  const stencilShift = pack.components.some(
    (c) => c.dataType === C.SpriteMask && scene.nodes.has(c.nodeId),
  )
    ? 1
    : 0;
  const ancestors = (node: SceneNode) => {
    const nodes: SceneNode[] = [];
    for (let n: SceneNode | undefined = node; n; n = n.parent) nodes.push(n);
    return nodes;
  };
  const maskActive = (mask: (typeof masks)[number]) => {
    const data = mask.data as R<UIMaskT>,
      graphic = pack.getComponent(data.graphicComponentId);
    return !!(
      graphic &&
      enabled.get(mask.id) &&
      enabled.get(graphic.id) &&
      scene.nodes.get(mask.nodeId)?.activeInHierarchy
    );
  };
  try {
    for (const component of images) {
      const image = component.data as R<UIImageT>,
        node = scene.nodes.get(component.nodeId)!;
      const lineage = ancestors(node),
        canvasNode = lineage.find((n) => scene.canvases.has(n.id));
      if (!canvasNode) continue;
      const canvas = scene.canvases.get(canvasNode.id)!;
      const rootId = scene.rootCanvases.get(node.id)!,
        root = scene.canvases.get(rootId)!;
      const sortCanvas =
        lineage.find((n) => scene.canvases.get(n.id)?.overrideSorting) || scene.nodes.get(rootId)!;
      const sorting = scene.canvases.get(sortCanvas.id)!;
      const definition = new MeshRendererT(
        0,
        [],
        sorting.sortingLayerId,
        canvasSortingRank(pack, sorting.sortingLayerId)!,
        sorting.sortingOrder,
      );
      const parentMasks = masks.filter(
        (m) =>
          lineage.some((n) => n.id === m.nodeId && n !== node) &&
          lineage.findIndex((n) => n.id === m.nodeId) <= lineage.findIndex((n) => n === sortCanvas),
      );
      const parentRects = rectMasks.filter(
        (m) =>
          lineage.some((n) => n.id === m.nodeId && n !== node) &&
          lineage.findIndex((n) => n.id === m.nodeId) <= lineage.findIndex((n) => n === sortCanvas),
      );
      parentRects.sort(
        (a, b) =>
          lineage.findIndex((n) => n.id === a.nodeId) - lineage.findIndex((n) => n.id === b.nodeId),
      );
      const own = masks.find(
        (m) => m.nodeId === node.id && (m.data as R<UIMaskT>).graphicComponentId === component.id,
      );
      const graphic = canvasRenderers.find((c) => c.nodeId === node.id);
      const spriteId = image.overrideSpriteAssetId || image.spriteAssetId,
        sprite = pack.document.assets.find((a) => a.id === spriteId)?.sprite;
      const material = image.materialId
        ? pack.document.materials.find((m) => m.id === image.materialId)!
        : new MaterialT();
      if (!image.materialId) {
        const m = material as MaterialT;
        m.model = 7;
        m.renderState = new RenderStateT();
        m.renderState.cull = 0;
        m.renderState.srcRgb = m.renderState.srcAlpha = 1;
        m.renderState.depthTestSource = 1;
        m.renderQueue = 3000;
      }
      const texture = sprite
        ? await acquire(spriteMaterial(material, sprite), spriteTextureKey(sprite))
        : material.textures.length
          ? await acquire(material)
          : Texture.WHITE;
      const inheritedGroups = lineage.map((n) => groups.filter((g) => g.nodeId === n.id));
      const alpha = () => {
        let value = 1;
        for (const atNode of inheritedGroups) {
          let stop = false;
          for (const group of atNode) {
            if (!enabled.get(group.id)) continue;
            const data = group.data as R<CanvasGroupT>;
            value *= data.alpha;
            stop ||= data.ignoreParentGroups;
          }
          if (stop) break;
        }
        return value;
      };
      const pixelPerfect = () => {
        if (root.mode === 2) return false;
        const override = lineage.find((n) => scene.canvases.get(n.id)?.overridePixelPerfect);
        return (override ? scene.canvases.get(override.id)! : root).pixelPerfect;
      };
      for (const pop of own ? [false, true] : [false]) {
        const state = structuredClone(material.renderState!) as RenderStateT;
        const local = Object.assign(
          new MaterialT(),
          sprite ? spriteMaterial(material, sprite) : material,
        );
        local.renderState = state;
        if (state.depthTestSource === 1) state.depthTest = root.mode === 0 ? 7 : 3;
        const pixelMatrix = mat4.create(),
          pixelInverse = mat4.create();
        const adjustedRect = () => {
          if (!pixelPerfect()) return;
          const rootNode = scene.nodes.get(rootId)!;
          if (!mat4.invert(pixelInverse, rootNode.worldMatrix)) return;
          mat4.multiply(pixelMatrix, pixelInverse, node.worldMatrix);
          // Root Canvas local coordinates are centered; pixel snapping uses its lower-left origin.
          pixelMatrix[12] = pixelMatrix[12]! + rootNode.layout!.width * 0.5;
          pixelMatrix[13] = pixelMatrix[13]! + rootNode.layout!.height * 0.5;
          return pixelAdjustedRect(
            node.layout!.width,
            node.layout!.height,
            node.rect!.pivot!,
            pixelMatrix,
          );
        };
        const geometry = () =>
          imageGeometry(
            pack,
            image,
            node.layout!.width,
            node.layout!.height,
            node.rect!.pivot!,
            adjustedRect(),
          );
        const mesh = new SceneMesh(node, definition, local, geometry(), 0, texture, pack);
        let lastRect = adjustedRect();
        let lastW = node.layout!.width,
          lastH = node.layout!.height,
          lastX = node.rect!.pivot!.x,
          lastY = node.rect!.pivot!.y,
          lastPixel = pixelPerfect();
        mesh.geometryProvider = () => {
          const w = node.layout!.width,
            h = node.layout!.height,
            p = node.rect!.pivot!,
            pixel = pixelPerfect(),
            nextRect = adjustedRect();
          const sameRect =
            nextRect?.x === lastRect?.x &&
            nextRect?.y === lastRect?.y &&
            nextRect?.width === lastRect?.width &&
            nextRect?.height === lastRect?.height;
          if (
            sameRect &&
            w === lastW &&
            h === lastH &&
            p.x === lastX &&
            p.y === lastY &&
            pixel === lastPixel
          )
            return;
          lastW = w;
          lastH = h;
          lastX = p.x;
          lastY = p.y;
          lastPixel = pixel;
          lastRect = nextRect;
          return imageGeometry(pack, image, w, h, p, nextRect);
        };
        const color = { r: 1, g: 1, b: 1, a: 1 };
        mesh.rendererColor = () => {
          Object.assign(color, image.color);
          color.a *= alpha();
          return color;
        };
        mesh.animationEnabled = () =>
          !!enabled.get(component.id) &&
          (!graphic || !!enabled.get(graphic.id)) &&
          !(
            graphic &&
            (graphic.data as R<CanvasRendererT>).cullTransparentMesh &&
            alpha() * image.color!.a < 0.001
          );
        mesh.uiSortGroup = sortCanvas.id;
        mesh.uiSequence = pop ? sequence.get(node.id)!.exit : sequence.get(node.id)!.enter;
        mesh.uiStencil = true;
        mesh.uiOverlay = root.mode === 0;
        mesh.sortAtNode = sortCanvas;
        const face = new StencilFaceT();
        const stencil = new StencilStateT(0, 0, 0, face, face);
        state.stencil = stencil;
        mesh.beforeSync = () => {
          const depth = parentMasks.reduce((count, m) => count + Number(maskActive(m)), 0);
          const active = own && maskActive(own);
          check(
            depth + (active ? 1 : 0) + stencilShift <= 8,
            'LIMIT',
            'Combined source masks exceed eight stencil bits',
          );
          const parent = (1 << depth) - 1,
            bit = 1 << depth;
          let reference = parent,
            read = parent,
            write = 0,
            compare = depth ? 2 : 7,
            pass = 0;
          state.colorWriteMask = material.renderState!.colorWriteMask;
          if (active) {
            reference = pop ? parent : parent | bit;
            write = bit;
            pass = 2;
            compare = pop ? 7 : depth ? 2 : 7;
            read = pop ? 0 : parent;
            if (pop || !(own!.data as R<UIMaskT>).showGraphic) state.colorWriteMask = 0;
          } else if (pop) {
            mesh.visible = false;
            return;
          } else if (!image.maskable) {
            read = 0;
            reference = 0;
            compare = 7;
          }
          face.compare = compare;
          face.pass = pass;
          face.fail = face.depthFail = 0;
          stencil.reference = reference << stencilShift;
          stencil.readMask = read << stencilShift;
          stencil.writeMask = write << stencilShift;
        };
        const inverse = mat4.create(),
          maskTransform = mat4.create(),
          low = vec3.create(),
          high = vec3.create();
        const clip = { matrix: inverse, rect: new Float32Array(4), softness: new Float32Array(2) };
        mesh.clipContext = () => {
          if (!image.maskable) return;
          const rootNode = scene.nodes.get(rootId)!;
          if (!mat4.invert(inverse, rootNode.worldMatrix)) return;
          let count = 0,
            loX = -Infinity,
            loY = -Infinity,
            hiX = Infinity,
            hiY = Infinity;
          for (const mask of parentRects) {
            if (!enabled.get(mask.id) || !scene.nodes.get(mask.nodeId)!.activeInHierarchy) continue;
            const definition = mask.data as R<RectMask2DT>,
              n = scene.nodes.get(mask.nodeId)!;
            mat4.multiply(maskTransform, inverse, n.worldMatrix);
            const p = n.rect!.pivot!,
              w = n.layout!.width,
              h = n.layout!.height;
            vec3.transformMat4(low, [-p.x * w, -p.y * h, 0], maskTransform);
            vec3.transformMat4(high, [(1 - p.x) * w, (1 - p.y) * h, 0], maskTransform);
            const pad = definition.padding!;
            loX = Math.max(loX, low[0]! + pad.x);
            loY = Math.max(loY, low[1]! + pad.y);
            hiX = Math.min(hiX, high[0]! - pad.z);
            hiY = Math.min(hiY, high[1]! - pad.w);
            if (count++ === 0) clip.softness.set([definition.softness!.x, definition.softness!.y]);
          }
          if (!count) return;
          clip.rect.set([loX, loY, hiX, hiY]);
          return clip;
        };
        mesh.uiContext = () => ({
          gamma: canvas.vertexColorGamma,
          alphaClip:
            !!(own && maskActive(own)) ||
            (material.floats.find((f) => f.name === '_UseUIAlphaClip')?.value ?? 0) > 0,
        });
        result.push(mesh);
      }
    }
  } catch (error) {
    for (const mesh of result) mesh.destroy();
    throw error;
  }
  return result;
}
