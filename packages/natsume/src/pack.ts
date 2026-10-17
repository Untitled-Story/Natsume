import { check } from './errors.js';
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
  }
  #assertAlive() {
    check(!this.#disposed, 'DISPOSED', 'Pack has been disposed');
  }
}
