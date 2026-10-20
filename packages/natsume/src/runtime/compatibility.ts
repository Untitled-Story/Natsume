import { animationSupport, animatorSupport } from './animation.js';
import { rendererVertexStride, particleMaterialSlots } from '../rendering/mesh-selection.js';
import { NatsumeError, type ErrorCode } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { InstanceOptions, ScriptIdentity } from './runtime.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { RectLayoutT } from '../format/generated/noa/ir/rect-layout.js';
import type { AnimatorT } from '../format/generated/noa/ir/animator.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import { CameraPolicy } from '../format/generated/noa/ir/camera-policy.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { copyEnvironment } from '../rendering/particle-environment.js';
import { rendererSupport } from '../rendering/renderer-support.js';
import { emitterSupport } from './emitter-support.js';
import { prewarmDuration } from './prewarm.js';
import { SupportChecks, type SupportIssue } from './support-checks.js';

/** A blocking configuration or an explicit approximation for the selected entry. */
export interface CompatibilityIssue extends SupportIssue {
  /** Name from package metadata, falling back to the entry root name. */
  readonly packageName: string;
  readonly componentId?: number;
}

export interface CompatibilityReport {
  /** True when no blocking issue was found; drawing and script success are not guaranteed. */
  readonly compatible: boolean;
  readonly issues: readonly CompatibilityIssue[];
}

/** All preflight issues. The error code is the first blocking issue's code. */
export class NatsumeCompatibilityError extends NatsumeError {
  readonly issues: readonly CompatibilityIssue[];
  constructor(report: CompatibilityReport) {
    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const display = (value: unknown) => {
      const text =
        JSON.stringify(value, (_, v: unknown) =>
          typeof v === 'bigint' || (typeof v === 'number' && !Number.isFinite(v)) ? String(v) : v,
        ) ?? 'undefined';
      return text.length > 240 ? text.slice(0, 237) + '...' : text;
    };
    super(
      (errors[0]?.code ?? 'CAPABILITY') as ErrorCode,
      errors
        .map(
          (issue) =>
            `${issue.packageName}${issue.componentId === undefined ? '' : ` / component ${issue.componentId}`} / ${issue.field}=${display(issue.value)}: ${issue.message}`,
        )
        .join('\n'),
    );
    this.name = 'NatsumeCompatibilityError';
    this.issues = report.issues;
  }
}

export interface CompatibilityContext {
  readonly maxTextureSize: number;
  readonly availableTexturePixels: number;
  readonly cachedMaterialIds: ReadonlySet<number>;
  readonly imageBitmapAvailable: boolean;
  readonly hasScript: (identity: ScriptIdentity) => boolean;
  readonly disposed: boolean;
}

/** @internal Data-only preflight; does not decode images or construct runtime objects. */
export function checkCompatibility(
  pack: EffectPack,
  options: InstanceOptions,
  context: CompatibilityContext,
): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const seen = new Set<string>();
  const entry = pack.document.entries.find(
    (e) => e.id === (options.entryId ?? pack.document.defaultEntryId),
  );
  const packageName = String(
    pack.document.metadata.find((m) => m.name === 'name')?.value ||
      pack.getNode(entry?.roots[0] ?? 0)?.name ||
      pack.manifest.document,
  );
  const append = (items: readonly SupportIssue[], componentId?: number) => {
    for (const item of items) {
      const key = JSON.stringify([componentId, item.field, item.code, item.severity]);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(
        Object.freeze({
          ...item,
          packageName,
          ...(componentId === undefined ? {} : { componentId }),
        }),
      );
    }
  };
  const global = new SupportChecks();
  global.require(
    !context.disposed,
    'DISPOSED',
    'runtime',
    'disposed',
    'Runtime has been destroyed',
  );
  global.require(!pack.disposed, 'DISPOSED', 'pack', 'disposed', 'Pack has been disposed');
  const finish = (): CompatibilityReport =>
    Object.freeze({
      compatible: !issues.some((issue) => issue.severity === 'error'),
      issues: Object.freeze(issues),
    });
  if (pack.disposed || context.disposed) {
    append(global.issues);
    return finish();
  }
  global.require(entry, 'HOST', 'entryId', options.entryId, 'Unknown entry');
  global.require(
    options.seed === undefined ||
      (Number.isInteger(options.seed) && options.seed >= 0 && options.seed <= 0xffffffff),
    'HOST',
    'seed',
    options.seed,
    'Instance seed must be uint32',
  );
  const layout = options.parentLayout;
  global.require(
    !layout ||
      (Number.isFinite(layout.width) &&
        Number.isFinite(layout.height) &&
        layout.width >= 0 &&
        layout.height >= 0),
    'HOST',
    'parentLayout',
    layout ? { ...layout } : undefined,
    'Invalid parent layout',
  );
  global.require(
    options.sourceColorSpace === undefined ||
      options.sourceColorSpace === 'gamma' ||
      options.sourceColorSpace === 'linear',
    'HOST',
    'sourceColorSpace',
    options.sourceColorSpace,
    'Unknown source color space',
  );
  const matrix = options.displayMatrix;
  if (matrix) {
    global.require(
      matrix.length === 16 && Array.from(matrix).every(Number.isFinite),
      'HOST',
      'displayMatrix',
      Array.from(matrix),
      'Display matrix requires 16 finite values',
    );
    global.require(
      matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] === 1,
      'CAPABILITY',
      'displayMatrix',
      Array.from(matrix),
      'Display transform supports affine matrices',
    );
  }
  const env = options.particleEnvironment;
  if (env)
    for (const field of [
      'fog',
      'gravity',
      'viewPosition',
      'viewVelocity',
      'depth',
      'softParticles',
    ] as const) {
      try {
        copyEnvironment({ fog: { mode: 'none' }, [field]: env[field] });
      } catch (error) {
        if (!(error instanceof NatsumeError)) throw error;
        global.require(
          false,
          error.code,
          `particleEnvironment.${field}`,
          field === 'softParticles' ? 'invalid depth texture or UV transform' : env[field],
          error.message,
        );
      }
    }
  const gravity = env?.gravity ?? options.gravity;
  global.require(
    gravity === undefined ||
      (Array.isArray(gravity) && gravity.length === 3 && gravity.every(Number.isFinite)),
    'HOST',
    'particleEnvironment.gravity',
    gravity ? Array.from(gravity) : undefined,
    'Invalid particle gravity',
  );
  if (
    pack.document.colorContext?.projectColorSpace === ColorSpace.Unspecified &&
    !options.sourceColorSpace
  )
    global.warn(
      'DEFAULT_COLOR_SPACE',
      'sourceColorSpace',
      'gamma',
      'Source project color space is absent; Gamma is the editable default.',
    );
  if (!entry) {
    append(global.issues);
    return finish();
  }
  global.require(
    entry.cameraPolicy === CameraPolicy.HostRequired,
    'CAPABILITY',
    'cameraPolicy',
    entry.cameraPolicy,
    'Embedded cameras are not implemented; use a host display matrix',
  );
  const children = new Map<number, number[]>();
  for (const node of pack.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const nodeIds = new Set<number>();
  const queue = [...entry.roots];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    global.require(
      !nodeIds.has(id),
      'CAPABILITY',
      'roots',
      entry.roots,
      'Overlapping entry roots are unsupported',
    );
    if (nodeIds.has(id)) continue;
    nodeIds.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  const components = pack.components.filter((c) => nodeIds.has(c.nodeId));
  const systems = components.filter((c) => c.dataType === C.ParticleSystem);
  const systemMap = new Map(systems.map((c) => [c.id, c.data as R<ParticleSystemT>]));
  const capacity = systems.reduce(
    (sum, c) => sum + (c.data as R<ParticleSystemT>).main!.maxParticles,
    0,
  );
  global.require(
    capacity <= 250_000,
    'LIMIT',
    'maxParticles',
    capacity,
    'Total particle capacity exceeds playback limit',
  );
  const work = systems.reduce((sum, c) => {
    const main = (c.data as R<ParticleSystemT>).main!;
    return sum + (c.enabled ? main.maxParticles * Math.ceil(prewarmDuration(main) * 60) : 0);
  }, 0);
  global.require(
    work <= 40_000_000,
    'LIMIT',
    'prewarm',
    work,
    'Instance prewarm work exceeds playback budget',
  );
  if (systems.length)
    global.warn(
      'NATSUME_RANDOM_SEQUENCE',
      'seed',
      options.seed,
      'Particle random channels are reproducible in Natsume; Unity native seeds do not reproduce the same births.',
    );
  append(global.issues);
  let vertices = 0,
    pixels = 0;
  const materials = new Set<number>();
  for (const c of components) {
    const rules = new SupportChecks();
    if (c.dataType === C.ParticleSystem) {
      const source = c.data as R<ParticleSystemT>;
      rules.issues.push(
        ...emitterSupport(source, gravity, nodeIds.has(source.main!.customSpaceNodeId)),
      );
    }
    if (c.dataType === C.RectLayout && entry.roots.includes(c.nodeId)) {
      const rect = c.data as R<RectLayoutT>;
      rules.require(
        layout ||
          (rect.anchorMin!.x === rect.anchorMax!.x && rect.anchorMin!.y === rect.anchorMax!.y),
        'HOST',
        'parentLayout',
        undefined,
        `Node ${c.nodeId} requires an external parent layout size`,
      );
    }
    if (c.dataType === C.Animator)
      rules.issues.push(...animatorSupport(c.data as R<AnimatorT>, c.id));
    if (c.enabled && c.dataType === C.CustomComponent) {
      const script = (c.data as R<CustomComponentT>).script;
      if (!script || !context.hasScript(script))
        rules.warn(
          'UNKNOWN_SCRIPT',
          'script',
          script,
          'No script factory is registered; serialized data is retained.',
        );
    }
    if (c.enabled && c.dataType === C.ParticleRenderer) {
      const definition = c.data as R<ParticleRendererT>;
      const system = systemMap.get(definition.systemComponentId);
      rules.require(
        system,
        'SEMANTIC',
        'systemComponentId',
        definition.systemComponentId,
        'Renderer system is outside entry',
      );
      const slots = [...particleMaterialSlots(definition)];
      // A missing primary material is a Unity error shader, not a supported material model.
      if (!slots.includes(0)) slots.unshift(0);
      for (const slot of slots) {
        const material = pack.document.materials.find((m) => m.id === definition.materials[slot]);
        rules.require(
          material,
          'SEMANTIC',
          `materials.${slot}`,
          definition.materials[slot],
          'Missing material',
        );
        if (system && material) {
          rules.issues.push(
            ...rendererSupport(definition, material, pack, system.main!.maxParticles, env),
          );
          vertices += system.main!.maxParticles * rendererVertexStride(definition, pack);
          if (!materials.has(material.id)) {
            materials.add(material.id);
            for (const [index, binding] of material.textures.entries()) {
              const size = pack.getImageSize(binding.imageId);
              rules.require(
                size,
                'SEMANTIC',
                `materials.${material.id}.textures.${index}.imageId`,
                binding.imageId,
                'Missing texture bytes',
              );
              if (!size) continue;
              rules.require(
                size.width <= context.maxTextureSize &&
                  size.height <= context.maxTextureSize &&
                  size.width * size.height <= 16_777_216,
                'LIMIT',
                `materials.${material.id}.textures.${index}.size`,
                size,
                'Decoded texture exceeds GPU/pixel limit',
              );
              if (!context.cachedMaterialIds.has(material.id)) pixels += size.width * size.height;
            }
          }
        }
      }
    }
    append(rules.issues, c.id);
  }
  const totals = new SupportChecks();
  const opaqueGroups = new Map<string, Set<number>>();
  for (const c of components) {
    if (!c.enabled || c.dataType !== C.ParticleRenderer) continue;
    const renderer = c.data as R<ParticleRendererT>;
    for (const slot of particleMaterialSlots(renderer)) {
      const material = pack.document.materials.find((m) => m.id === renderer.materials[slot]);
      if (!material || material.renderQueue > 2500) continue;
      const key = `${renderer.sortingLayerRank}/${renderer.sortingOrder}/${material.renderQueue}`;
      const group = opaqueGroups.get(key) ?? new Set<number>();
      group.add(material.id);
      opaqueGroups.set(key, group);
    }
  }
  for (const [key, ids] of opaqueGroups)
    if (ids.size > 1)
      totals.warn(
        'OPAQUE_MATERIAL_IDENTITY',
        'materials.renderQueue',
        [...ids],
        `Opaque group ${key} uses package material declaration order; Unity transient material identities are not serialized.`,
      );
  totals.require(
    vertices <= 1_000_000,
    'LIMIT',
    'maxParticles*vertices',
    vertices,
    'Instance expanded vertex budget exceeded',
  );
  totals.require(
    pixels <= context.availableTexturePixels,
    'LIMIT',
    'texturePixels',
    pixels,
    'Runtime decoded texture budget exceeded',
  );
  totals.require(
    materials.size === 0 || context.imageBitmapAvailable,
    'HOST',
    'createImageBitmap',
    context.imageBitmapAvailable,
    'ImageBitmap decoding is required',
  );
  for (const animation of pack.document.animations)
    totals.issues.push(...animationSupport(animation));
  append(totals.issues);
  return finish();
}
