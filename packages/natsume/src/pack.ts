import { check } from './errors.js';
import { decodePngPixels, type ImagePixels } from './loader/png-pixels.js';
import { exrImageSize, isOpenExr } from './loader/exr-pixels.js';
import type { DocumentT } from './format/generated/noa/ir/document.js';
import type { MeshT } from './format/generated/noa/mesh/mesh.js';
import { ComponentData } from './format/generated/noa/ir/component-data.js';
import type { Manifest } from './loader/manifest.js';

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Immutable inspection data; no renderer, camera, or runtime instance is created. */
export class EffectPack {
  readonly document: DeepReadonly<DocumentT>;
  readonly manifest: DeepReadonly<Manifest>;
  #files: Map<string, Uint8Array>;
  #meshes: Map<number, DeepReadonly<MeshT>>;
  #disposed = false;
  #pixels = new Map<number, ImagePixels>();
  #decodedPixelCount = 0;

  constructor(
    document: DocumentT,
    manifest: Manifest,
    files: Map<string, Uint8Array>,
    meshes: Map<number, MeshT>,
  ) {
    this.document = freeze(document);
    this.manifest = freeze(manifest);
    this.#files = files;
    this.#meshes = new Map([...meshes].map(([id, mesh]) => [id, freeze(mesh)]));
  }
  get disposed() {
    return this.#disposed;
  }
  get nodes() {
    return this.document.nodes;
  }
  get components() {
    return this.document.components;
  }
  get customComponents() {
    return this.document.components.filter(
      (component) => component.dataType === ComponentData.CustomComponent,
    );
  }
  getNode(id: number) {
    return this.nodes.find((node) => node.id === id);
  }
  getComponent(id: number) {
    return this.components.find((component) => component.id === id);
  }
  getComponents(nodeId: number) {
    return this.components.filter((component) => component.nodeId === nodeId);
  }
  findNodes(name: string) {
    return this.nodes.filter((node) => node.name === name);
  }
  getMesh(id: number) {
    this.#assertAlive();
    return this.#meshes.get(id);
  }
  getAssetBytes(id: number): Uint8Array | undefined {
    this.#assertAlive();
    const file = this.manifest.files.find((file) => file.asset_id === id);
    const bytes = file ? this.#files.get(file.path) : undefined;
    return bytes?.slice();
  }
  /** @internal Reads PNG or retained source OpenEXR dimensions without allocating pixels. */
  getImageSize(id: number): { readonly width: number; readonly height: number } | undefined {
    this.#assertAlive();
    const file = this.manifest.files.find(
      (file) => file.asset_id === id && (file.kind === 'image' || file.kind === 'source_data'),
    );
    const bytes = file ? this.#files.get(file.path) : undefined;
    if (bytes && isOpenExr(bytes)) return exrImageSize(bytes);
    if (file?.kind === 'source_data') return;
    if (!bytes || bytes.length < 24) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  /** @internal Lazily shares raw CPU pixels between shape samplers. Released with this pack. */
  getImagePixels(id: number): ImagePixels {
    this.#assertAlive();
    let image = this.#pixels.get(id);
    if (!image) {
      const size = this.getImageSize(id);
      check(
        size && this.#decodedPixelCount + size.width * size.height <= 64 * 1024 * 1024,
        'LIMIT',
        'Decoded image budget exceeded',
      );
      const bytes = this.getAssetBytes(id);
      check(bytes, 'SEMANTIC', 'Missing shape image bytes');
      check(!isOpenExr(bytes), 'CAPABILITY', 'OpenEXR CPU shape sampling is unsupported');
      image = decodePngPixels(bytes);
      this.#pixels.set(id, image);
      this.#decodedPixelCount += image.width * image.height;
    }
    return image;
  }
  describe() {
    const counts: Record<string, number> = {};
    const scripts = new Map<
      string,
      { assembly: string; namespace: string; className: string; count: number }
    >();
    const slots = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (
          'hostForceFieldsSlot' in value &&
          'filter' in value &&
          ((key === 'influences' && value.filter === 0) ||
            (key === 'hostForceFieldsSlot' && value.filter === 1))
        )
          continue;
        if (key.startsWith('host') && key.endsWith('Slot') && typeof child === 'string' && child)
          slots.add(child);
        else visit(child);
      }
    };
    for (const component of this.components) {
      const type = ComponentData[component.dataType];
      counts[type] = (counts[type] ?? 0) + 1;
      if (component.dataType === ComponentData.CustomComponent) {
        const data = component.data as DeepReadonly<
          import('./format/generated/noa/ir/custom-component.js').CustomComponentT
        >;
        const script = data.script;
        if (script) {
          const key = JSON.stringify([script.assembly, script.namespace, script.className]);
          const entry = scripts.get(key) ?? {
            assembly: String(script.assembly),
            namespace: String(script.namespace),
            className: String(script.className),
            count: 0,
          };
          entry.count++;
          scripts.set(key, entry);
        }
      }
    }
    visit(this.document);
    if (
      this.document.features.some(
        (f) => f.name === 'host.legacy-particle-environment' && f.required,
      )
    ) {
      slots.add('source-scene-fog');
      slots.add('source-soft-particles');
    }
    return freeze({
      counts: {
        nodes: this.nodes.length,
        components: this.components.length,
        animations: this.document.animations.length,
        materials: this.document.materials.length,
        assets: this.document.assets.length,
      },
      components: counts,
      scripts: [...scripts.values()],
      requiredHostInputs: [...slots].sort(),
      features: this.document.features,
      // Data inspection cannot certify renderer, options or executable subset.
      // Runtime.instantiate performs those checks before producing an instance.
      playbackReady: false as const,
    });
  }
  dispose(): void {
    this.#disposed = true;
    this.#files.clear();
    this.#meshes.clear();
    this.#pixels.clear();
    this.#decodedPixelCount = 0;
  }
  #assertAlive() {
    check(!this.#disposed, 'DISPOSED', 'Pack has been disposed');
  }
}
