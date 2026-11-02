import {
  canvasLayout,
  canvasEnvironmentSupport,
  type CanvasLayout,
} from '../rendering/canvas-layout.js';
import { assertSupport } from './support-checks.js';
import type { CanvasEnvironment } from '../rendering/canvas-environment.js';
import { AuthoredCamera, type CameraEnvironment } from '../rendering/camera-environment.js';
import type { CameraT } from '../format/generated/noa/ir/camera.js';
import type { CanvasT } from '../format/generated/noa/ir/canvas.js';
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
  readonly localPosition = { x: 0, y: 0, z: 0 };
  readonly localRotation = { x: 0, y: 0, z: 0, w: 1 };
  readonly localScale = { x: 1, y: 1, z: 1 };
  transformDirty = false;
  layoutDirty = false;
  renderOffsetX = 0;
  renderOffsetY = 0;
  inheritedRenderOffsetX = 0;
  inheritedRenderOffsetY = 0;
  active: boolean;
  destroyed = false;
  activeInHierarchy = true;
  layout: LayoutSize | undefined;
  constructor(
    readonly source: R<NodeT>,
    readonly parent: SceneNode | undefined,
    readonly rect: RectLayoutT | undefined,
  ) {
    this.id = source.id;
    this.name = String(source.name);
    this.active = source.active;
    Object.assign(this.localPosition, source.transform!.position);
    Object.assign(this.localRotation, source.transform!.rotation);
    Object.assign(this.localScale, source.transform!.scale);
  }
}

/** Unity-space hierarchy. The instance root is an origin; its external anchor is host-owned. */
export class Scene {
  private authoredCamera: AuthoredCamera | undefined;
  private authoredEnvironment: CameraEnvironment | undefined;
  private sourceCanvasEnvironment: CanvasEnvironment | undefined;
  private readonly cameraSources = new Map<number, { node: SceneNode; definition: R<CameraT> }>();
  private readonly canvasCameras = new Map<number, AuthoredCamera>();
  private readonly cameraState = new Map<number, Float32Array>();
  private defaultCameraId: number | undefined;
  /** Resolved source view for camera canvases; host inputs remain available when no source view is selected. */
  get resolvedCanvasEnvironment(): CanvasEnvironment | undefined {
    return this.canvasEnvironmentFor();
  }
  /** @internal The source camera assigned to a screen Canvas. */
  canvasCameraId(canvas: R<CanvasT>): number | undefined {
    return canvas.cameraComponentId || this.authoredCamera?.id;
  }
  canvasEnvironmentFor(canvas?: R<CanvasT>): CanvasEnvironment | undefined {
    const environment = this.authoredEnvironment;
    if (!environment) return this.sourceCanvasEnvironment;
    const main = canvas?.cameraComponentId
      ? this.canvasCameras.get(canvas.cameraComponentId)
      : this.authoredCamera;
    if (canvas?.mode === 1 && this.cameraSources.size)
      check(
        main,
        'HOST',
        'ScreenCamera requires cameraEnvironment.mainCameraId or an explicit Canvas Camera',
      );
    if (canvas?.cameraComponentId)
      check(main, 'HOST', `Canvas Camera ${canvas.cameraComponentId} must belong to this entry`);
    return {
      displays: {
        ...this.sourceCanvasEnvironment?.displays,
        [environment.targetDisplay]: { width: environment.width, height: environment.height },
      },
      ...(main
        ? {
            mainCamera: {
              viewMatrix: main.view,
              projectionMatrix: main.projection,
              viewport: {
                x: main.definition.viewport!.x,
                y: main.definition.viewport!.y,
                width: main.definition.viewport!.z,
                height: main.definition.viewport!.w,
              },
            },
          }
        : this.sourceCanvasEnvironment?.mainCamera
          ? { mainCamera: this.sourceCanvasEnvironment.mainCamera }
          : {}),
    };
  }
  readonly nodes = new Map<number, SceneNode>();
  readonly ordered: SceneNode[] = [];
  get layoutSize(): LayoutSize | undefined {
    return this.roots.length === 1 ? this.nodes.get(this.roots[0]!)?.layout : undefined;
  }
  readonly canvases = new Map<number, R<CanvasT>>();
  readonly rootCanvases = new Map<number, number>();
  readonly canvasLayouts = new Map<number, CanvasLayout>();

  private readonly hostLayout: LayoutSize | undefined;
  constructor(
    pack: EffectPack,
    private readonly roots: readonly number[],
    hostLayout?: LayoutSize,
    canvasEnvironment?: CanvasEnvironment,
    cameraEnvironment?: CameraEnvironment,
    defaultCameraId?: number,
  ) {
    this.hostLayout = hostLayout;
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
        node = new SceneNode(
          n,
          parent,
          rects.has(n.id) ? (structuredClone(rects.get(n.id)!) as RectLayoutT) : undefined,
        );
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
        node.layout = {
          width: (parentSize?.width ?? 0) * stretchX + delta.x,
          height: (parentSize?.height ?? 0) * stretchY + delta.y,
        };
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
      Object.assign(node.localPosition, { x, y, z });
      mat4.fromRotationTranslationScale(
        node.localMatrix,
        [q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1],
        [x, y, z],
        [s?.x ?? 1, s?.y ?? 1, s?.z ?? 1],
      );
    }
    for (const c of pack.components)
      if (c.dataType === ComponentData.Canvas && c.enabled && this.nodes.has(c.nodeId))
        this.canvases.set(c.nodeId, c.data as R<CanvasT>);
    for (const n of this.ordered) {
      const parent = n.parent && this.rootCanvases.get(n.parent.id);
      if (parent !== undefined) this.rootCanvases.set(n.id, parent);
      else if (this.canvases.has(n.id)) this.rootCanvases.set(n.id, n.id);
    }
    this.sourceCanvasEnvironment = canvasEnvironment;
    this.defaultCameraId = defaultCameraId;
    for (const c of pack.components)
      if (c.dataType === ComponentData.Camera) {
        const node = this.nodes.get(c.nodeId);
        if (node) this.cameraSources.set(c.id, { node, definition: c.data as R<CameraT> });
      }
    this.updateNodes();
    this.selectCamera(cameraEnvironment);
    this.configureCanvasEnvironment(this.resolvedCanvasEnvironment);
    for (const n of this.ordered) if (n.rect) this.initialRects.set(n.id, structuredClone(n.rect));
    this.update();
  }
  setCanvasEnvironment(environment: CanvasEnvironment): void {
    const previous = this.sourceCanvasEnvironment;
    this.sourceCanvasEnvironment = environment;
    try {
      this.configureCanvasEnvironment(this.resolvedCanvasEnvironment);
    } catch (error) {
      this.sourceCanvasEnvironment = previous;
      throw error;
    }
    for (const n of this.ordered) if (n.rect) n.layoutDirty = true;
    this.update();
  }
  private selectCamera(environment?: CameraEnvironment): void {
    const id =
      environment?.mainCameraId ??
      this.defaultCameraId ??
      (this.cameraSources.size === 1 ? this.cameraSources.keys().next().value : undefined);
    const source = id === undefined ? undefined : this.cameraSources.get(id);
    this.authoredEnvironment = environment;
    this.authoredCamera =
      source && environment ? new AuthoredCamera(id!, source.node, source.definition) : undefined;
    this.authoredCamera?.sync(environment!);
    this.canvasCameras.clear();
    this.cameraState.clear();
    if (environment)
      for (const [id, source] of this.cameraSources) {
        const camera = new AuthoredCamera(id, source.node, source.definition);
        camera.sync(environment);
        this.canvasCameras.set(id, camera);
        this.cameraState.set(id, new Float32Array(34).fill(NaN));
      }
  }
  /** @internal Bind mutable animation state without mutating package Camera definitions. */
  setCameraDefinitions(definitions: ReadonlyMap<number, R<CameraT>>): void {
    for (const [id, definition] of definitions) {
      const source = this.cameraSources.get(id);
      if (source) source.definition = definition;
    }
    this.selectCamera(this.authoredEnvironment);
    this.update();
  }
  /** @internal Transactional display replacement, including camera-driven Canvas layout. */
  setCameraEnvironment(environment: CameraEnvironment): void {
    const previous = this.authoredEnvironment;
    this.selectCamera(environment);
    try {
      this.configureCanvasEnvironment(this.resolvedCanvasEnvironment);
      this.update();
    } catch (error) {
      this.selectCamera(previous);
      this.configureCanvasEnvironment(this.resolvedCanvasEnvironment);
      this.update();
      throw error;
    }
  }
  private configureCanvasEnvironment(environment?: CanvasEnvironment): void {
    const layouts = new Map<number, CanvasLayout>();
    for (const [id, canvas] of this.canvases) {
      if (this.rootCanvases.get(id) !== id || canvas.mode === 2) continue;
      const resolved = this.authoredEnvironment ? this.canvasEnvironmentFor(canvas) : environment;
      check(resolved, 'HOST', 'Screen Canvas requires canvasEnvironment');
      assertSupport(canvasEnvironmentSupport(canvas, resolved));
      layouts.set(id, canvasLayout(canvas, resolved));
    }
    this.canvasLayouts.clear();
    for (const [id, layout] of layouts) this.canvasLayouts.set(id, layout);
    for (const n of this.ordered) if (n.rect) n.layoutDirty = true;
  }
  /** Rebuild only animation-owned matrices; host matrix edits remain intact. */
  private rebuild(n: SceneNode): void {
    if (n.rect && n.layoutDirty) {
      const r = n.rect,
        parent = n.parent?.layout ?? this.hostLayout;
      const sx = r.anchorMax!.x - r.anchorMin!.x,
        sy = r.anchorMax!.y - r.anchorMin!.y;
      Object.assign(n.layout!, {
        width: (parent?.width ?? 0) * sx + r.sizeDelta!.x,
        height: (parent?.height ?? 0) * sy + r.sizeDelta!.y,
      });
      const pp = n.parent?.rect?.pivot ?? { x: 0.5, y: 0.5 };
      Object.assign(n.localPosition, {
        x:
          r.anchoredPosition!.x +
          (n.parent ? (parent?.width ?? 0) * (r.anchorMin!.x + sx * r.pivot!.x - pp.x) : 0),
        y:
          r.anchoredPosition!.y +
          (n.parent ? (parent?.height ?? 0) * (r.anchorMin!.y + sy * r.pivot!.y - pp.y) : 0),
        z: r.anchoredPosition!.z,
      });
      n.transformDirty = true;
    }
    if (n.transformDirty) {
      const p = n.localPosition,
        q = n.localRotation,
        s = n.localScale;
      mat4.fromRotationTranslationScale(
        n.localMatrix,
        [q.x, q.y, q.z, q.w],
        [p.x, p.y, p.z],
        [s.x, s.y, s.z],
      );
    }
  }
  reset(): void {
    for (const n of this.ordered) {
      n.destroyed = false;
      n.active = n.source.active;
      Object.assign(n.localPosition, n.source.transform!.position);
      Object.assign(n.localRotation, n.source.transform!.rotation);
      Object.assign(n.localScale, n.source.transform!.scale);
      if (n.rect) Object.assign(n.rect, structuredClone(this.initialRects.get(n.id)!));
      n.transformDirty = true;
      n.layoutDirty = !!n.rect;
    }
    this.update();
  }
  private readonly initialRects = new Map<number, RectLayoutT>();
  update(): void {
    this.updateNodes();
    if (this.authoredEnvironment && this.canvases.size) {
      const environment = this.authoredEnvironment;
      this.authoredCamera?.sync(environment);
      let anyChanged = false;
      for (const [id, camera] of this.canvasCameras) {
        const state = this.cameraState.get(id)!;
        camera.sync(environment);
        let changed = state[32] !== environment.width || state[33] !== environment.height;
        for (let i = 0; i < 16; i++) {
          changed ||= state[i] !== camera.view[i] || state[i + 16] !== camera.projection[i];
          state[i] = camera.view[i]!;
          state[i + 16] = camera.projection[i]!;
        }
        if (changed) {
          state[32] = environment.width;
          state[33] = environment.height;
          anyChanged = true;
        }
      }
      if (anyChanged) {
        this.configureCanvasEnvironment(this.resolvedCanvasEnvironment);
        this.updateNodes();
      }
    }
  }
  private updateNodes(): void {
    for (const n of this.ordered) {
      if (n.parent?.layoutDirty && n.rect) n.layoutDirty = true;
      this.rebuild(n);
      const canvas = this.canvasLayouts.get(n.id);
      if (canvas) {
        if (n.rect) {
          n.rect.pivot!.x = n.rect.pivot!.y = 0.5;
          n.layout = { width: canvas.width, height: canvas.height };
        }
        if (n.parent) {
          const inverse = mat4.invert(mat4.create(), n.parent.worldMatrix);
          check(inverse, 'HOST', 'Screen Canvas parent transform must be invertible');
          mat4.multiply(n.localMatrix, inverse, canvas.world);
        } else mat4.copy(n.localMatrix, canvas.world);
      }
      n.activeInHierarchy = !n.destroyed && n.active && (n.parent?.activeInHierarchy ?? true);
      const q = n.localRotation;
      quat.set(n.worldRotation, q.x, q.y, q.z, q.w);
      if (n.parent) quat.multiply(n.worldRotation, n.parent.worldRotation, n.worldRotation);
      if (n.parent) mat4.multiply(n.worldMatrix, n.parent.worldMatrix, n.localMatrix);
      else mat4.copy(n.worldMatrix, n.localMatrix);
      if (canvas) mat4.getRotation(n.worldRotation, n.worldMatrix);
    }
    for (const n of this.ordered) {
      n.transformDirty = false;
      n.layoutDirty = false;
    }
  }
}
