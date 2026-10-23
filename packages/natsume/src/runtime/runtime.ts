import { spriteTextureKey } from '../rendering/sprite-texture.js';
import { spriteGeometry } from '../rendering/sprite-geometry.js';
import { MeshRendererT as MeshRendererDefinition } from '../format/generated/noa/ir/mesh-renderer.js';
import type { SpriteRendererT } from '../format/generated/noa/ir/sprite-renderer.js';
import { TextureBindingT } from '../format/generated/noa/ir/texture-binding.js';
import { MaterialT as MaterialDefinition } from '../format/generated/noa/ir/material.js';
import { SceneMesh, sceneMaterialPasses } from '../rendering/scene-mesh.js';
import { copyRenderEnvironment, type RenderEnvironment } from '../rendering/render-environment.js';
import { materialSupport } from '../rendering/material-support.js';
import { assertSupport } from './support-checks.js';
import type { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import type { MeshFilterT } from '../format/generated/noa/ir/mesh-filter.js';
import type { AnimationEventHandler, NatsumeAnimationEvent } from './animation-events.js';
import type { AnimationTarget } from './simulation.js';
import { rendererCanPlay } from './animation.js';
import { rendererVertexStride, particleMaterialSlots } from '../rendering/mesh-selection.js';
import { ensureMaterialPipe } from '../rendering/material-pipe.js';
import { Alignment } from '../format/generated/noa/ir/alignment.js';
import { Container, ImageSource, Rectangle, Texture, type WebGLRenderer } from 'pixi.js';
import { mat4 } from 'gl-matrix';
import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';
import type { ScriptIdentityT } from '../format/generated/noa/ir/script-identity.js';
import { ComponentData } from '../format/generated/noa/ir/component-data.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { AddressMode } from '../format/generated/noa/ir/address-mode.js';
import { FilterMode } from '../format/generated/noa/ir/filter-mode.js';
import { RenderMode } from '../format/generated/noa/ir/render-mode.js';
import { ParticleMesh, type SourceColorSpace } from '../rendering/particle-mesh.js';
import { Simulation, type SimulationOptions } from './simulation.js';
import type { SceneNode } from './scene.js';
import { copyEnvironment, type ParticleEnvironment } from '../rendering/particle-environment.js';
import {
  checkCompatibility,
  NatsumeCompatibilityError,
  type CompatibilityReport,
} from './compatibility.js';

export interface InstanceOptions extends SimulationOptions {
  /** Host gravity, view, fog and depth inputs; required for Unity legacy particle materials. */
  readonly particleEnvironment?: ParticleEnvironment;
  /** Inputs required by source scene material programs. */
  readonly renderEnvironment?: RenderEnvironment;
  readonly sourceColorSpace?: SourceColorSpace;
  /** Column-major affine transform into Pixi local coordinates, including clip-depth Z. */
  readonly displayMatrix?: ArrayLike<number>;
}
export interface ScriptBehavior {
  /** Receives source messages from the Animator on this node; return true when handled. */
  onAnimationEvent?: AnimationEventHandler;
  onEnable?(): void;
  onDisable?(): void;
  update?(deltaSeconds: number): void;
  destroy?(): void;
}
export interface ScriptContext {
  readonly effect: EffectInstance;
  readonly node: NatsumeNode;
  readonly component: R<CustomComponentT>;
}
export type ScriptFactory = (context: ScriptContext) => ScriptBehavior;
export type ScriptIdentity = Pick<R<ScriptIdentityT>, 'assembly' | 'namespace' | 'className'>;
function scriptKey(s: ScriptIdentity): string {
  return JSON.stringify([s.assembly, s.namespace, s.className]);
}
interface TextureLease {
  promise: Promise<Texture>;
  refs: number;
  pixels: number;
  bitmap?: ImageBitmap;
}

/** Translation in effect-container local units, after the display matrix. */
export interface RenderOffset {
  readonly x: number;
  readonly y: number;
}

export class NatsumeNode {
  constructor(
    private readonly effect: EffectInstance,
    private readonly node: SceneNode,
  ) {}
  get id(): number {
    return this.node.id;
  }
  get name(): string {
    return this.node.name;
  }
  get active(): boolean {
    return this.node.active;
  }
  get activeInHierarchy(): boolean {
    return this.node.activeInHierarchy;
  }
  /** Unity-space world transform as a copy; excludes render offsets. */
  get worldMatrix(): Float32Array {
    return Float32Array.from(this.node.worldMatrix);
  }
  /** Parent within this instance; undefined for an entry root. */
  get parent(): NatsumeNode | undefined {
    return this.node.parent ? this.effect.getNode(this.node.parent.id) : undefined;
  }
  /** Own render offset as a copy, excluding ancestor offsets. */
  get renderOffset(): RenderOffset {
    return { x: this.node.renderOffsetX, y: this.node.renderOffsetY };
  }
  /**
   * Translates this node's renderers and descendants; ancestor offsets add.
   * Applies immediately, survives restart, and leaves simulation and depth unchanged.
   * @param offset Finite effect-local coordinates, or null to clear this node's offset.
   * @throws NatsumeError after destruction completes or if coordinates are not finite.
   */
  setRenderOffset(offset: RenderOffset | null): void {
    this.effect.setNodeRenderOffset(this.node, offset);
  }
  setActive(active: boolean): void {
    this.effect.setNodeActive(this.id, active);
  }
}

export class EffectInstance {
  readonly container = new Container({ label: 'Natsume effect' });
  private readonly meshes: (ParticleMesh | SceneMesh)[] = [];
  private readonly passOrder = new Map<ParticleMesh | SceneMesh, number>();
  private readonly materialOrder: Map<number, number>;
  private readonly matrix = mat4.fromValues(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1);
  private readonly nodeViews = new Map<number, NatsumeNode>();
  private readonly behaviors: {
    node: SceneNode;
    behavior: ScriptBehavior;
    active: boolean;
    failed: boolean;
  }[] = [];
  private readonly eventHandlers = new Set<AnimationEventHandler>();
  private readonly missingReceivers = new Set<string>();
  private updating = false;
  private eventRevision = 0;
  private dispatchingEvent = false;
  private disposed = false;
  private destroying = false;
  private colorSpace: SourceColorSpace;
  private environment: ParticleEnvironment | undefined;
  private renderEnvironment: RenderEnvironment | undefined;
  constructor(
    readonly simulation: Simulation,
    private readonly runtime: NatsumeRuntime,
    private readonly releaseTextures: () => void,
    options: InstanceOptions,
  ) {
    simulation.onAnimationEvent = (event) => this.dispatchAnimationEvent(event);
    this.materialOrder = new Map(simulation.pack.document.materials.map((m, i) => [m.id, i]));
    this.environment = copyEnvironment(options.particleEnvironment);
    this.renderEnvironment = copyRenderEnvironment(options.renderEnvironment);
    this.colorSpace =
      options.sourceColorSpace ??
      (simulation.pack.document.colorContext?.projectColorSpace === ColorSpace.Linear
        ? 'linear'
        : 'gamma');
    check(
      this.colorSpace === 'gamma' || this.colorSpace === 'linear',
      'HOST',
      'Unknown source color space',
    );
    this.syncLayoutBounds();
    if (options.displayMatrix) this.setDisplayMatrix(options.displayMatrix);
    if (
      simulation.pack.document.colorContext?.projectColorSpace === ColorSpace.Unspecified &&
      !options.sourceColorSpace
    )
      simulation.diagnostics.push({
        code: 'DEFAULT_COLOR_SPACE',
        message: 'Source project color space is absent; Gamma is the editable default.',
      });
  }
  get destroyed(): boolean {
    return this.disposed;
  }
  get layoutSize() {
    return this.simulation.scene.layoutSize;
  }
  get state() {
    return this.simulation.state;
  }
  get particleCount(): number {
    return this.simulation.particleCount;
  }
  get diagnostics() {
    return this.simulation.diagnostics.slice();
  }
  get sourceColorSpace(): SourceColorSpace {
    return this.colorSpace;
  }
  get time(): number {
    return this.simulation.time;
  }
  get displayMatrix(): Float32Array {
    return Float32Array.from(this.matrix);
  }
  /** Nodes with allocated renderers, including renderers that animations can enable; unique per node. */
  get renderedNodes(): readonly NatsumeNode[] {
    this.assertAlive();
    return [...new Set(this.meshes.map((mesh) => mesh.node.id))].map((id) => this.getNode(id)!);
  }
  private assertAlive(): void {
    check(!this.disposed, 'DISPOSED', 'Effect instance has been destroyed');
  }
  setSourceColorSpace(value: SourceColorSpace): void {
    this.assertAlive();
    check(value === 'gamma' || value === 'linear', 'HOST', 'Unknown color space');
    this.colorSpace = value;
    this.render();
  }
  /** Replaces particle environment inputs. Host depth textures remain borrowed. */
  setParticleEnvironment(value: ParticleEnvironment): void {
    this.assertAlive();
    const next = copyEnvironment(value);
    const gravity = [...this.simulation.emitters.values()].map(
      (emitter) => [emitter, emitter.resolveGravity(next?.gravity)] as const,
    );
    for (const mesh of this.meshes) {
      if (!(mesh instanceof ParticleMesh)) continue;
      const definition = mesh.definition;
      const requiresViewPosition =
        (definition.mode === RenderMode.StretchedBillboard && definition.freeformStretching) ||
        (definition.alignment === Alignment.Facing &&
          definition.mode !== RenderMode.HorizontalBillboard &&
          definition.mode !== RenderMode.VerticalBillboard);
      check(
        !requiresViewPosition || next?.viewPosition,
        'HOST',
        'Facing alignment and Freeform stretch require particleEnvironment.viewPosition',
      );
    }
    this.environment = next;
    for (const [emitter, value] of gravity) emitter.gravity = value;
    for (const mesh of this.meshes) mesh.environment = next;
    this.render();
  }
  /** Replaces source material inputs; invalid or missing required values leave the instance unchanged. */
  setRenderEnvironment(value: RenderEnvironment): void {
    this.assertAlive();
    const next = copyRenderEnvironment(value);
    for (const mesh of this.meshes)
      assertSupport(materialSupport(mesh.materialDefinition, this.simulation.pack, next));
    this.renderEnvironment = next;
    for (const mesh of this.meshes) mesh.renderEnvironment = next;
    this.render();
  }
  setDisplayMatrix(matrix: ArrayLike<number>): void {
    this.assertAlive();
    check(
      matrix.length === 16 && Array.from(matrix).every(Number.isFinite),
      'HOST',
      'Display matrix requires 16 finite values',
    );
    check(
      matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] === 1,
      'CAPABILITY',
      'Initial display transform supports affine matrices',
    );
    mat4.copy(this.matrix, matrix as mat4);
    this.render();
  }
  getNode(id: number): NatsumeNode | undefined {
    this.assertAlive();
    const node = this.simulation.scene.nodes.get(id);
    if (!node) return;
    let view = this.nodeViews.get(id);
    if (!view) {
      view = new NatsumeNode(this, node);
      this.nodeViews.set(id, view);
    }
    return view;
  }
  /** Sets the node immediately; a playing animation may overwrite it on the next fixed step. */
  setNodeActive(id: number, active: boolean): void {
    this.assertAlive();
    this.simulation.setNodeActive(id, active);
    this.syncBehaviors();
    this.render();
  }
  play(): void {
    this.assertAlive();
    this.simulation.play();
    if (this.disposed) return;
    this.syncBehaviors();
    this.render();
  }
  pause(): void {
    this.eventRevision++;
    this.assertAlive();
    this.simulation.pause();
  }
  stop(mode: 'drain' | 'clear' = 'drain'): void {
    this.eventRevision++;
    this.assertAlive();
    this.simulation.stop(mode);
    this.render();
  }
  restart(): void {
    this.eventRevision++;
    this.assertAlive();
    this.simulation.restart();
    if (this.disposed) return;
    this.syncBehaviors();
    this.render();
  }
  /** Restarts a state by ID or name, applying its initial sample and source speed / cycle offset. */
  playAnimatorState(animatorId: number, state: string | number): void {
    this.eventRevision++;
    this.assertAlive();
    this.simulation.applyAnimatorState(animatorId, state);
    if (this.disposed) return;
    this.syncBehaviors();
    this.render();
  }
  /** Higher priorities write later. Applies next fixed step; retained across state changes and restart. */
  setAnimationPriority(target: AnimationTarget, priority: number): void {
    this.assertAlive();
    this.simulation.setAnimationPriority(target, priority);
  }
  /** Subscribes to source animation messages. Returns an idempotent unsubscribe function. */
  onAnimationEvent(handler: AnimationEventHandler): () => void {
    this.assertAlive();
    check(typeof handler === 'function', 'HOST', 'Animation event handler must be a function');
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }
  private dispatchAnimationEvent(event: NatsumeAnimationEvent): void {
    if (this.disposed || this.dispatchingEvent) return;
    this.dispatchingEvent = true;
    const revision = this.eventRevision;
    let handled = false;
    const invoke = (callback: AnimationEventHandler): void => {
      try {
        handled = callback(event) === true || handled;
      } catch (error) {
        this.simulation.diagnostics.push({
          code: 'ANIMATION_EVENT_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    try {
      this.syncBehaviors();
      for (const handler of [...this.eventHandlers]) {
        if (this.disposed || revision !== this.eventRevision) break;
        if (this.eventHandlers.has(handler)) invoke(handler);
      }
      for (const b of this.behaviors) {
        if (this.disposed || revision !== this.eventRevision) break;
        if (b.node.id === event.nodeId && b.active && !b.failed && b.behavior.onAnimationEvent)
          invoke((e) => b.behavior.onAnimationEvent!(e));
      }
      const key = event.clipId + ':' + event.animatorId + ':' + event.name;
      if (
        !this.disposed &&
        revision === this.eventRevision &&
        event.requireReceiver &&
        !handled &&
        !this.missingReceivers.has(key)
      ) {
        this.missingReceivers.add(key);
        this.simulation.diagnostics.push({
          code: 'ANIMATION_EVENT_RECEIVER',
          componentId: event.animatorId,
          message: 'Animation event has no receiver: ' + event.name,
        });
      }
    } finally {
      this.dispatchingEvent = false;
    }
  }
  update(seconds: number): void {
    this.assertAlive();
    check(
      !this.updating && !this.dispatchingEvent,
      'HOST',
      'Recursive effect update is unsupported',
    );
    this.updating = true;
    try {
      const before = this.simulation.time;
      this.simulation.update(seconds);
      if (this.disposed) return;
      const advanced = this.simulation.time - before;
      if (advanced > 0)
        for (const b of this.behaviors) {
          if (this.disposed) return;
          if (b.active && !b.failed) b.failed = !this.invoke(() => b.behavior.update?.(advanced));
        }
      if (this.disposed) return;
      this.syncBehaviors();
      this.render();
    } finally {
      this.updating = false;
    }
  }
  private invoke(action: () => void): boolean {
    try {
      action();
      return true;
    } catch (error) {
      if (this.runtime.scriptErrors === 'throw') throw error;
      this.simulation.diagnostics.push({
        code: 'SCRIPT_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  private syncBehaviors(): void {
    for (const b of this.behaviors) {
      if (b.failed) continue;
      const active = b.node.activeInHierarchy;
      if (active !== b.active) {
        b.active = active;
        b.failed = !this.invoke(() =>
          active ? b.behavior.onEnable?.() : b.behavior.onDisable?.(),
        );
      }
    }
  }
  /** @internal */ initializeScripts(): void {
    for (const c of this.simulation.pack.customComponents) {
      const node = this.simulation.scene.nodes.get(c.nodeId);
      if (!node || !c.enabled) continue;
      const component = c.data as R<CustomComponentT>,
        identity = component.script;
      const factory = identity ? this.runtime.getScriptFactory(identity) : undefined;
      if (!factory) {
        this.simulation.diagnostics.push({
          code: 'UNKNOWN_SCRIPT',
          componentId: c.id,
          message: `No factory for ${identity ? `${identity.namespace}.${identity.className}` : 'unresolved script'}; serialized data retained.`,
        });
        continue;
      }
      this.invoke(() => {
        const behavior = factory({ effect: this, node: this.getNode(node.id)!, component });
        check(
          behavior && typeof behavior === 'object',
          'HOST',
          'Script factory must return a behavior object',
        );
        this.behaviors.push({ node, behavior, active: false, failed: false });
      });
    }
  }
  /** @internal */ addMesh(mesh: ParticleMesh | SceneMesh): void {
    mesh.environment = this.environment;
    mesh.renderEnvironment = this.renderEnvironment;
    this.passOrder.set(mesh, this.meshes.length);
    this.meshes.push(mesh);
    this.container.addChild(mesh);
  }
  /** @internal */ setNodeRenderOffset(node: SceneNode, offset: RenderOffset | null): void {
    check(!this.disposed || this.destroying, 'DISPOSED', 'Effect instance has been destroyed');
    const x = offset === null ? 0 : offset.x,
      y = offset === null ? 0 : offset.y;
    check(
      Number.isFinite(x) && Number.isFinite(y),
      'HOST',
      'Render offset requires finite coordinates',
    );
    if (node.renderOffsetX === x && node.renderOffsetY === y) return;
    node.renderOffsetX = x;
    node.renderOffsetY = y;
    this.syncRenderOffsets();
  }
  private syncRenderOffsets(): void {
    for (const node of this.simulation.scene.ordered) {
      node.inheritedRenderOffsetX = node.renderOffsetX + (node.parent?.inheritedRenderOffsetX ?? 0);
      node.inheritedRenderOffsetY = node.renderOffsetY + (node.parent?.inheritedRenderOffsetY ?? 0);
    }
    for (const mesh of this.meshes) {
      const node = mesh.node;
      mesh.position.set(node.inheritedRenderOffsetX, node.inheritedRenderOffsetY);
    }
  }
  private syncLayoutBounds(): void {
    const size = this.simulation.scene.layoutSize;
    if (!size) return;
    const pivot = this.simulation.scene.nodes.get(this.simulation.entry.roots[0]!)?.rect?.pivot;
    const x = -size.width * (pivot?.x ?? 0.5),
      y = -size.height * (1 - (pivot?.y ?? 0.5));
    const bounds = this.container.boundsArea ?? new Rectangle();
    bounds.x = Math.min(x, x + size.width);
    bounds.y = Math.min(y, y + size.height);
    bounds.width = Math.abs(size.width);
    bounds.height = Math.abs(size.height);
    this.container.boundsArea = bounds;
  }
  private render(): void {
    this.syncLayoutBounds();
    for (const mesh of this.meshes) mesh.sync(this.matrix, this.colorSpace);
    this.meshes.sort((a, b) => {
      const stage =
        Number(a.materialDefinition.renderQueue > 2500) -
        Number(b.materialDefinition.renderQueue > 2500);
      if (stage) return stage;
      const layer = a.definition.sortingLayerRank - b.definition.sortingLayerRank;
      const order = a.definition.sortingOrder - b.definition.sortingOrder;
      const queue = a.materialDefinition.renderQueue - b.materialDefinition.renderQueue;
      if (layer || order || queue) return layer || order || queue;
      // Opaque queues group material state before front-to-back distance. Native
      // object IDs are not serialized; declaration order gives stable identities.
      if (a.materialDefinition.renderQueue <= 2500) {
        const material =
          this.materialOrder.get(b.materialDefinition.id)! -
          this.materialOrder.get(a.materialDefinition.id)!;
        if (material) return material;
      }
      const depth =
        a.sortingDepth + a.definition.sortingFudge - (b.sortingDepth + b.definition.sortingFudge);
      return (
        (a.materialDefinition.renderQueue <= 2500 ? depth : -depth) ||
        this.passOrder.get(a)! - this.passOrder.get(b)!
      );
    });
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!;
      if (this.container.children[i] !== mesh) this.container.setChildIndex(mesh, i);
    }
  }
  destroy(): void {
    this.eventRevision++;
    if (this.disposed) return;
    this.disposed = true;
    this.destroying = true;
    let failure: unknown;
    for (const b of this.behaviors) {
      try {
        if (b.active && !b.failed) this.invoke(() => b.behavior.onDisable?.());
      } catch (error) {
        failure ??= error;
      }
      try {
        this.invoke(() => b.behavior.destroy?.());
      } catch (error) {
        failure ??= error;
      }
    }
    this.destroying = false;
    for (const mesh of this.meshes) mesh.destroy();
    this.meshes.length = 0;
    this.passOrder.clear();
    this.simulation.stop('clear');
    this.simulation.emitters.clear();
    this.nodeViews.clear();
    this.eventHandlers.clear();
    this.simulation.onAnimationEvent = undefined;
    this.behaviors.length = 0;
    this.container.destroy();
    this.releaseTextures();
    this.runtime.forget(this);
    if (failure) throw failure;
  }
}

export class NatsumeRuntime {
  private readonly instances = new Set<EffectInstance>();
  private readonly textures = new Map<EffectPack, Map<number | string, TextureLease>>();
  private readonly scripts = new Map<string, ScriptFactory>();
  private disposed = false;
  readonly scriptErrors: 'isolate' | 'throw';
  private retainedPixels = 0;
  constructor(
    readonly renderer: WebGLRenderer,
    options: { scriptErrors?: 'isolate' | 'throw' } = {},
  ) {
    check(
      renderer.context?.webGLVersion === 2,
      'HOST',
      'Natsume requires an initialized Pixi WebGL2 renderer',
    );
    this.scriptErrors = options.scriptErrors ?? 'isolate';
    ensureMaterialPipe(renderer);
  }
  registerScript(identity: ScriptIdentity, factory: ScriptFactory): void {
    check(!this.disposed, 'DISPOSED', 'Runtime has been destroyed');
    this.scripts.set(scriptKey(identity), factory);
  }
  /** @internal */ getScriptFactory(identity: ScriptIdentity): ScriptFactory | undefined {
    return this.scripts.get(scriptKey(identity));
  }
  /** @internal */ forget(instance: EffectInstance): void {
    this.instances.delete(instance);
  }
  /**
   * Checks the selected entry and host inputs without creating an instance or decoding textures.
   * Includes blocking issues and approximation warnings; does not run script factories.
   */
  checkCompatibility(pack: EffectPack, options: InstanceOptions = {}): CompatibilityReport {
    return checkCompatibility(pack, options, {
      disposed: this.disposed,
      maxTextureSize: this.disposed
        ? 0
        : (this.renderer.gl.getParameter(this.renderer.gl.MAX_TEXTURE_SIZE) as number),
      availableTexturePixels: 64 * 1024 * 1024 - this.retainedPixels,
      cachedMaterialIds: new Set(this.textures.get(pack)?.keys()),
      imageBitmapAvailable: typeof createImageBitmap === 'function',
      hasScript: (identity) => !!this.getScriptFactory(identity),
    });
  }
  /**
   * Creates an independent effect after compatibility checks pass.
   * @throws NatsumeCompatibilityError with all preflight issues when configuration is blocked.
   */
  async instantiate(pack: EffectPack, options: InstanceOptions = {}): Promise<EffectInstance> {
    const compatibility = this.checkCompatibility(pack, options);
    if (!compatibility.compatible) throw new NatsumeCompatibilityError(compatibility);
    const environment = copyEnvironment(options.particleEnvironment);
    const renderEnvironment = copyRenderEnvironment(options.renderEnvironment);
    options = {
      ...options,
      ...(environment ? { particleEnvironment: environment } : {}),
      ...(renderEnvironment ? { renderEnvironment } : {}),
    };
    const simulation = new Simulation(pack, {
        ...options,
        ...(options.particleEnvironment?.gravity
          ? { gravity: options.particleEnvironment.gravity }
          : {}),
      }),
      releases: (() => void)[] = [];
    const instance = new EffectInstance(
      simulation,
      this,
      () => {
        for (const release of releases) release();
      },
      options,
    );
    try {
      const renderers = pack.components
        .filter(
          (c) =>
            rendererCanPlay(pack, c.id, c.enabled) &&
            c.dataType === ComponentData.ParticleRenderer &&
            simulation.scene.nodes.has(c.nodeId),
        )
        .map((c) => ({ id: c.id, data: c.data as R<ParticleRendererT> }));
      renderers.sort(
        (a, b) =>
          a.data.sortingLayerRank - b.data.sortingLayerRank ||
          a.data.sortingOrder - b.data.sortingOrder ||
          a.id - b.id,
      );
      const totalVertices = renderers.reduce((sum, { data }) => {
        const emitter = simulation.emitters.get(data.systemComponentId);
        check(emitter, 'SEMANTIC', 'Renderer system is outside entry');
        const count = rendererVertexStride(data, pack);
        check(count !== undefined, 'SEMANTIC', 'Missing mesh');
        return sum + emitter.main.maxParticles * count * particleMaterialSlots(data).length;
      }, 0);
      check(totalVertices <= 1_000_000, 'LIMIT', 'Instance expanded vertex budget exceeded');
      for (const { id, data } of renderers) {
        const emitter = simulation.emitters.get(data.systemComponentId);
        check(emitter, 'SEMANTIC', 'Renderer system is outside entry');
        for (const slot of particleMaterialSlots(data)) {
          const material =
            simulation.bindings.materials.get(`${id}:${slot}`) ??
            pack.document.materials.find((m) => m.id === data.materials[slot]);
          check(material, 'SEMANTIC', 'Missing material');
          const frames = emitter.sheet?.mode === 1 ? emitter.sheet.spriteAssetIds : [];
          const sheetTextures: Texture[] = [];
          for (const frame of frames) {
            const sprite = pack.document.assets.find((a) => a.id === frame)!.sprite!;
            const lease = this.acquireTexture(
              pack,
              spriteMaterial(material, sprite),
              spriteTextureKey(sprite),
            );
            releases.push(lease.release);
            sheetTextures.push(await lease.promise);
          }
          const lease = frames.length ? undefined : this.acquireTexture(pack, material);
          if (lease) releases.push(lease.release);
          const texture = sheetTextures[0] ?? (await lease!.promise);
          check(!this.disposed, 'DISPOSED', 'Runtime was destroyed during instantiation');
          const mesh = new ParticleMesh(
            emitter,
            data,
            material,
            texture,
            pack,
            options.particleEnvironment,
            options.renderEnvironment,
            sheetTextures,
          );
          mesh.animationEnabled = () => simulation.bindings.enabled.get(id) ?? false;
          instance.addMesh(mesh);
        }
      }
      for (const component of pack.components) {
        if (
          component.dataType !== ComponentData.MeshRenderer ||
          !rendererCanPlay(pack, component.id, component.enabled)
        )
          continue;
        const node = simulation.scene.nodes.get(component.nodeId);
        if (!node) continue;
        const definition = component.data as R<MeshRendererT>;
        const filter = pack.getComponent(definition.meshFilterComponentId)!.data as R<MeshFilterT>;
        const geometry = filter.meshAssetId ? pack.getMesh(filter.meshAssetId) : undefined;
        for (const pass of sceneMaterialPasses(definition, geometry)) {
          const material =
            simulation.bindings.materials.get(`${component.id}:${pass.slot}`) ??
            pack.document.materials.find((m) => m.id === definition.materials[pass.slot])!;
          const lease = this.acquireTexture(pack, material);
          releases.push(lease.release);
          const texture = await lease.promise;
          check(!this.disposed, 'DISPOSED', 'Runtime has been destroyed');
          const mesh = new SceneMesh(
            node,
            definition,
            material,
            geometry!,
            pass.submesh,
            texture,
            pack,
          );
          mesh.animationEnabled = () => simulation.bindings.enabled.get(component.id) ?? false;
          instance.addMesh(mesh);
        }
      }
      for (const component of pack.components) {
        if (
          component.dataType !== ComponentData.SpriteRenderer ||
          !rendererCanPlay(pack, component.id, component.enabled)
        )
          continue;
        const node = simulation.scene.nodes.get(component.nodeId);
        if (!node) continue;
        const definition = component.data as R<SpriteRendererT>;
        if (!definition.spriteAssetId) continue;
        const sprite = pack.document.assets.find((a) => a.id === definition.spriteAssetId)!.sprite!;
        const geometry = spriteGeometry(pack, sprite, definition);
        if (!geometry.indices.length) continue;
        for (const [slot, id] of definition.materials.entries()) {
          if (!id) continue;
          const original =
            simulation.bindings.materials.get(`${component.id}:${slot}`) ??
            pack.document.materials.find((m) => m.id === id)!;
          const material = spriteMaterial(original, sprite);
          const lease = this.acquireTexture(pack, material, spriteTextureKey(sprite));
          releases.push(lease.release);
          const texture = await lease.promise;
          check(!this.disposed, 'DISPOSED', 'Runtime has been destroyed');
          const renderer = new MeshRendererDefinition(
            0,
            [id],
            definition.sortingLayerId,
            definition.sortingLayerIndex,
            definition.sortingOrder,
          );
          const mesh = new SceneMesh(node, renderer, material, geometry, 0, texture, pack);
          mesh.animationEnabled = () => simulation.bindings.enabled.get(component.id) ?? false;
          mesh.rendererColor = () =>
            simulation.bindings.spriteColors.get(component.id) ?? definition.color!;
          mesh.sortAtPivot = definition.sortPoint === 1;
          instance.addMesh(mesh);
        }
      }
      instance.initializeScripts();
      for (const issue of compatibility.issues)
        if (
          issue.severity === 'warning' &&
          !simulation.diagnostics.some(
            (diagnostic) =>
              diagnostic.code === issue.code && diagnostic.componentId === issue.componentId,
          )
        )
          simulation.diagnostics.push({
            code: issue.code,
            message: issue.message,
            ...(issue.componentId === undefined ? {} : { componentId: issue.componentId }),
          });
      this.instances.add(instance);
      return instance;
    } catch (error) {
      instance.destroy();
      if (this.textures.get(pack)?.size === 0) this.textures.delete(pack);
      throw error;
    }
  }
  private acquireTexture(
    pack: EffectPack,
    material: R<MaterialT>,
    cacheKey: number | string = material.id,
  ): { promise: Promise<Texture>; release: () => void } {
    if (material.textures.length === 0)
      return { promise: Promise.resolve(Texture.WHITE), release: () => {} };
    let cache = this.textures.get(pack);
    if (!cache) {
      cache = new Map();
      this.textures.set(pack, cache);
    }
    let lease = cache.get(cacheKey);
    if (!lease) {
      const binding = material.textures[0];
      check(binding, 'CAPABILITY', 'Material requires a texture');
      const bytes = pack.getAssetBytes(binding.imageId);
      check(bytes, 'SEMANTIC', 'Missing texture bytes');
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        width = header.getUint32(16),
        height = header.getUint32(20);
      const max = this.renderer.gl.getParameter(this.renderer.gl.MAX_TEXTURE_SIZE) as number;
      check(
        width <= max && height <= max && width * height <= 16_777_216,
        'LIMIT',
        'Decoded texture exceeds GPU/pixel limit',
      );
      check(typeof createImageBitmap === 'function', 'HOST', 'ImageBitmap decoding is required');
      const s = binding.sampler;

      const pixels = width * height;
      check(
        this.retainedPixels + pixels <= 64 * 1024 * 1024,
        'LIMIT',
        'Runtime decoded texture budget exceeded',
      );
      this.retainedPixels += pixels;
      const record: TextureLease = { refs: 0, pixels, promise: Promise.resolve(Texture.EMPTY) };
      record.promise = createImageBitmap(
        new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
      ).then((bitmap) => {
        record.bitmap = bitmap;
        const wrap = (mode: AddressMode | undefined) =>
          mode === AddressMode.Repeat
            ? 'repeat'
            : mode === AddressMode.Mirror
              ? 'mirror-repeat'
              : 'clamp-to-edge';
        return new Texture({
          source: new ImageSource({
            resource: bitmap,
            alphaMode: 'no-premultiply-alpha',
            format: 'rgba8unorm',
            autoGenerateMipmaps: s?.minFilter === FilterMode.Trilinear,
            mipmapFilter: s?.minFilter === FilterMode.Trilinear ? 'linear' : 'nearest',
            minFilter: s?.minFilter === FilterMode.Nearest ? 'nearest' : 'linear',
            magFilter: s?.magFilter === FilterMode.Nearest ? 'nearest' : 'linear',
            addressModeU: wrap(s?.wrapU),
            addressModeV: wrap(s?.wrapV),
          }),
        });
      });
      lease = record;
      cache.set(cacheKey, record);
    }
    lease.refs++;
    const record = lease,
      activeCache = cache;
    let released = false;
    return {
      promise: lease.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--record.refs === 0) {
          this.retainedPixels -= record.pixels;
          activeCache.delete(cacheKey);
          if (activeCache.size === 0) this.textures.delete(pack);
          void record.promise.then(
            (texture) => {
              texture.destroy(true);
              record.bitmap?.close();
            },
            () => record.bitmap?.close(),
          );
        }
      },
    };
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    for (const instance of this.instances)
      try {
        instance.destroy();
      } catch (error) {
        failure ??= error;
      }
    this.scripts.clear();
    if (failure) throw failure;
  }
}

/** Sprite image selection changes only the resource; animated material values remain live. */
function spriteMaterial(
  original: R<MaterialT>,
  sprite: R<import('../format/generated/noa/ir/sprite-asset.js').SpriteAssetT>,
): MaterialDefinition {
  const material = Object.assign(new MaterialDefinition(), original);
  const binding = Object.assign(new TextureBindingT(), original.textures[0]);
  binding.imageId = sprite.imageAssetId;
  binding.sampler = sprite.sampler as import('../format/generated/noa/ir/sampler.js').SamplerT;
  binding.colorSpace = sprite.colorSpace;
  material.textures = [binding];
  return material;
}
