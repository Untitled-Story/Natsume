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
import {
  ParticleMesh,
  ensureParticlePipe,
  type SourceColorSpace,
} from '../rendering/particle-mesh.js';
import { Simulation, type SimulationOptions } from './simulation.js';
import type { SceneNode } from './scene.js';
import { copyEnvironment, type ParticleEnvironment } from '../rendering/particle-environment.js';

export interface InstanceOptions extends SimulationOptions {
  /** Host fog and soft-particle inputs; required for Unity legacy particle materials. */
  readonly particleEnvironment?: ParticleEnvironment;
  readonly sourceColorSpace?: SourceColorSpace;
  /** Column-major affine transform into Pixi local coordinates, including clip-depth Z. */
  readonly displayMatrix?: ArrayLike<number>;
}
export interface ScriptBehavior {
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
  private readonly meshes: ParticleMesh[] = [];
  private readonly matrix = mat4.fromValues(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1);
  private readonly nodeViews = new Map<number, NatsumeNode>();
  private readonly behaviors: {
    node: SceneNode;
    behavior: ScriptBehavior;
    active: boolean;
    failed: boolean;
  }[] = [];
  private disposed = false;
  private destroying = false;
  private colorSpace: SourceColorSpace;
  private environment: ParticleEnvironment | undefined;
  constructor(
    readonly simulation: Simulation,
    private readonly runtime: NatsumeRuntime,
    private readonly releaseTextures: () => void,
    options: InstanceOptions,
  ) {
    this.environment = copyEnvironment(options.particleEnvironment);
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
    const size = simulation.scene.layoutSize;
    if (size) {
      const pivot = simulation.scene.nodes.get(simulation.entry.roots[0]!)?.rect?.pivot;
      this.container.boundsArea = new Rectangle(
        -size.width * (pivot?.x ?? 0.5),
        -size.height * (1 - (pivot?.y ?? 0.5)),
        size.width,
        size.height,
      );
    }
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
  /** Snapshot of nodes with enabled renderer components, including inactive nodes; unique per node. */
  get renderedNodes(): readonly NatsumeNode[] {
    this.assertAlive();
    return [...new Set(this.meshes.map((mesh) => mesh.emitter.node.id))].map(
      (id) => this.getNode(id)!,
    );
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
  /** Replaces fog/depth inputs. Host depth textures remain borrowed. */
  setParticleEnvironment(value: ParticleEnvironment): void {
    this.assertAlive();
    const next = copyEnvironment(value);
    this.environment = next;
    for (const mesh of this.meshes) mesh.environment = next;
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
  setNodeActive(id: number, active: boolean): void {
    this.assertAlive();
    this.simulation.setNodeActive(id, active);
    this.syncBehaviors();
    this.render();
  }
  play(): void {
    this.assertAlive();
    this.simulation.play();
    this.syncBehaviors();
    this.render();
  }
  pause(): void {
    this.assertAlive();
    this.simulation.pause();
  }
  stop(mode: 'drain' | 'clear' = 'drain'): void {
    this.assertAlive();
    this.simulation.stop(mode);
    this.render();
  }
  restart(): void {
    this.assertAlive();
    this.simulation.restart();
    this.syncBehaviors();
    this.render();
  }
  playAnimatorState(animatorId: number, state: string | number): void {
    this.assertAlive();
    this.simulation.applyAnimatorState(animatorId, state);
    this.syncBehaviors();
    this.render();
  }
  update(seconds: number): void {
    this.assertAlive();
    const before = this.simulation.time;
    this.simulation.update(seconds);
    const advanced = this.simulation.time - before;
    if (advanced > 0)
      for (const b of this.behaviors)
        if (b.active && !b.failed) b.failed = !this.invoke(() => b.behavior.update?.(advanced));
    this.syncBehaviors();
    this.render();
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
  /** @internal */ addMesh(mesh: ParticleMesh): void {
    mesh.environment = this.environment;
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
      const node = mesh.emitter.node;
      mesh.position.set(node.inheritedRenderOffsetX, node.inheritedRenderOffsetY);
    }
  }
  private render(): void {
    for (const mesh of this.meshes) mesh.sync(this.matrix, this.colorSpace);
  }
  destroy(): void {
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
    this.simulation.stop('clear');
    this.simulation.emitters.clear();
    this.nodeViews.clear();
    this.behaviors.length = 0;
    this.container.destroy();
    this.releaseTextures();
    this.runtime.forget(this);
    if (failure) throw failure;
  }
}

export class NatsumeRuntime {
  private readonly instances = new Set<EffectInstance>();
  private readonly textures = new Map<EffectPack, Map<number, TextureLease>>();
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
    ensureParticlePipe(renderer);
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
  async instantiate(pack: EffectPack, options: InstanceOptions = {}): Promise<EffectInstance> {
    check(!this.disposed, 'DISPOSED', 'Runtime has been destroyed');
    const environment = copyEnvironment(options.particleEnvironment);
    options = { ...options, ...(environment ? { particleEnvironment: environment } : {}) };
    const simulation = new Simulation(pack, options),
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
            c.enabled &&
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
        const count =
          data.mode === RenderMode.Mesh ? pack.getMesh(data.meshAssetIds[0]!)?.positions.length : 4;
        check(count !== undefined, 'SEMANTIC', 'Missing mesh');
        return sum + emitter.main.maxParticles * count;
      }, 0);
      check(totalVertices <= 1_000_000, 'LIMIT', 'Instance expanded vertex budget exceeded');
      for (const { data } of renderers) {
        const emitter = simulation.emitters.get(data.systemComponentId);
        check(emitter, 'SEMANTIC', 'Renderer system is outside entry');
        const material = pack.document.materials.find((m) => m.id === data.materials[0]);
        check(material, 'SEMANTIC', 'Missing material');
        const lease = this.acquireTexture(pack, material);
        releases.push(lease.release);
        const texture = await lease.promise;
        check(!this.disposed, 'DISPOSED', 'Runtime was destroyed during instantiation');
        instance.addMesh(
          new ParticleMesh(emitter, data, material, texture, pack, options.particleEnvironment),
        );
      }
      instance.initializeScripts();
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
  ): { promise: Promise<Texture>; release: () => void } {
    let cache = this.textures.get(pack);
    if (!cache) {
      cache = new Map();
      this.textures.set(pack, cache);
    }
    let lease = cache.get(material.id);
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
      check(
        !s || s.minFilter !== FilterMode.Trilinear,
        'CAPABILITY',
        'Mipmapped sampling unsupported',
      );
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
            minFilter: s?.minFilter === FilterMode.Nearest ? 'nearest' : 'linear',
            magFilter: s?.magFilter === FilterMode.Nearest ? 'nearest' : 'linear',
            addressModeU: wrap(s?.wrapU),
            addressModeV: wrap(s?.wrapV),
          }),
        });
      });
      lease = record;
      cache.set(material.id, record);
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
          activeCache.delete(material.id);
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
