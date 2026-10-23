import { MaterialModel as M } from '../format/generated/noa/ir/material-model.js';
import { canvasSortingRank } from '../rendering/canvas-sorting.js';
import { imageGeometry } from '../rendering/image-geometry.js';
import type { UIImageT } from '../format/generated/noa/ir/uiimage.js';
import { Scene } from './scene.js';
import type { SpriteMaskT } from '../format/generated/noa/ir/sprite-mask.js';
import { copyCanvasEnvironment } from '../rendering/canvas-environment.js';
import { canvasEnvironmentSupport } from '../rendering/canvas-layout.js';
import type { CanvasT } from '../format/generated/noa/ir/canvas.js';
import { spriteTextureKey } from '../rendering/sprite-texture.js';
import { spriteGeometry } from '../rendering/sprite-geometry.js';
import { ParticleModuleData } from '../format/generated/noa/ir/particle-module-data.js';
import type { TextureSheetModuleT } from '../format/generated/noa/ir/texture-sheet-module.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import { ShapeGeometry } from '../format/generated/noa/ir/shape-geometry.js';
import type { SpriteShapeT } from '../format/generated/noa/ir/sprite-shape.js';
import type { SpriteRendererT } from '../format/generated/noa/ir/sprite-renderer.js';
import { copyRenderEnvironment } from '../rendering/render-environment.js';
import { materialSupport, rendererEnvironmentSupport } from '../rendering/material-support.js';
import { sceneMaterialPasses } from '../rendering/scene-mesh.js';
import type { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import type { MeshFilterT } from '../format/generated/noa/ir/mesh-filter.js';
import { bindingWrites } from './animation-bindings.js';
import { SUPPORTED_FEATURES } from '../format/semantics.js';
import { ActionKind } from '../format/generated/noa/ir/action-kind.js';
import { AnimationProperty } from '../format/generated/noa/ir/animation-property.js';
import { ParticleParameter } from '../format/generated/noa/ir/particle-parameter.js';
import { animationSupport, animatorSupport, rendererCanPlay } from './animation.js';
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
  readonly cachedMaterialIds: ReadonlySet<number | string>;
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
  for (const feature of pack.document.features)
    if (feature.required)
      global.require(
        SUPPORTED_FEATURES[String(feature.name)] === feature.revision,
        'CAPABILITY',
        'features.' + feature.name,
        feature.revision,
        'Required feature is not implemented',
      );
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
  try {
    copyRenderEnvironment(options.renderEnvironment);
  } catch (error) {
    if (!(error instanceof NatsumeError)) throw error;
    global.require(
      false,
      error.code,
      'renderEnvironment',
      options.renderEnvironment,
      error.message,
    );
  }
  let canvasEnvironment;
  try {
    canvasEnvironment = copyCanvasEnvironment(options.canvasEnvironment);
  } catch (error) {
    if (!(error instanceof NatsumeError)) throw error;
    global.require(false, error.code, 'canvasEnvironment', undefined, error.message);
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
  const materials = new Set<number | string>();
  let uiScene: Scene | undefined;
  for (const c of components) {
    const rules = new SupportChecks();
    if (c.dataType === C.ParticleSystem) {
      const source = c.data as R<ParticleSystemT>;
      const animatedGravity = pack.document.animations.some((a) =>
        a.tracks.some(
          (t) =>
            t.binding!.targetId === c.id &&
            t.binding!.property === AnimationProperty.ParticleParameter &&
            t.binding!.parameter === ParticleParameter.GravityMultiplier,
        ),
      );
      rules.require(
        !animatedGravity || !!gravity || !!source.main!.gravity,
        'HOST',
        'main.gravityMultiplier',
        source.main!.gravityMultiplier,
        'Animated gravityMultiplier requires particleEnvironment.gravity',
      );
      rules.issues.push(
        ...emitterSupport(source, gravity, nodeIds.has(source.main!.customSpaceNodeId)),
      );
      for (const [index, module] of source.modules.entries()) {
        if (module.dataType !== ParticleModuleData.ShapeModule) continue;
        const shape = module.data as R<ShapeModuleT>;
        if (shape.geometryType !== ShapeGeometry.SpriteShape) continue;
        const id = (shape.geometry as R<SpriteShapeT>).spriteAssetId;
        const sprite = pack.document.assets.find((a) => a.id === id)?.sprite;
        const mesh = sprite && pack.getMesh(sprite.meshAssetId);
        rules.require(
          !id || (mesh?.positions.length && mesh.indices.length),
          'CAPABILITY',
          `modules.${index}.geometry.spriteAssetId`,
          id,
          'Sprite emission requires nonempty source geometry',
        );
      }
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
    if (c.dataType === C.Canvas && c.enabled) {
      const canvas = c.data as R<CanvasT>;
      rules.issues.push(...canvasEnvironmentSupport(canvas, canvasEnvironment));
      rules.require(
        canvasSortingRank(pack, canvas.sortingLayerId) !== undefined,
        'HOST',
        'sortingLayerId',
        canvas.sortingLayerId,
        'Canvas sorting layer rank is absent from package renderer records',
      );
    }
    if (c.dataType === C.UIImage) {
      const image = c.data as R<UIImageT>;
      try {
        const scene = (uiScene ??= new Scene(pack, entry.roots, layout, canvasEnvironment)),
          node = scene.nodes.get(c.nodeId)!;
        rules.require(
          node.rect && node.layout,
          'SEMANTIC',
          'rectLayout',
          undefined,
          'UIImage requires RectLayout',
        );
        if (node.rect && node.layout)
          vertices +=
            (components.some((m) => m.dataType === C.UIMask && m.nodeId === c.nodeId) ? 2 : 1) *
            imageGeometry(pack, image, node.layout.width, node.layout.height, node.rect.pivot!)
              .positions.length;
        let depth = 0;
        for (let parent = node; parent.parent; parent = parent.parent) {
          if (scene.canvases.get(parent.id)?.overrideSorting) break;
          depth += components.filter(
            (m) =>
              m.nodeId === parent.parent!.id &&
              m.dataType === C.UIMask &&
              m.enabled &&
              (m.data as { graphicComponentId: number }).graphicComponentId !== 0,
          ).length;
        }
        const capacity = components.some((m) => m.dataType === C.SpriteMask) ? 7 : 8;
        rules.require(
          depth <= capacity &&
            (depth < capacity ||
              !components.some(
                (m) => m.nodeId === c.nodeId && m.dataType === C.UIMask && m.enabled,
              )),
          'LIMIT',
          'stencil.depth',
          depth,
          'Combined source masks exceed eight stencil bits',
        );
      } catch (error) {
        if (!(error instanceof NatsumeError)) throw error;
        rules.require(false, error.code, 'geometry', undefined, error.message);
      }
      const material = pack.document.materials.find((m) => m.id === image.materialId);
      if (material) {
        rules.issues.push(...materialSupport(material, pack, options.renderEnvironment, true));
        if (
          material.model === M.LegacyParticleAdditive ||
          material.model === M.LegacyParticleAlphaBlend
        )
          rules.require(
            env,
            'CAPABILITY',
            'particleEnvironment',
            env,
            'Legacy materials require an explicit particleEnvironment',
          );
      }
      const sprite = pack.document.assets.find(
        (a) => a.id === (image.overrideSpriteAssetId || image.spriteAssetId),
      )?.sprite;
      const textures = sprite
        ? [{ id: sprite.imageAssetId, key: spriteTextureKey(sprite) }]
        : (material?.textures ?? []).map((t) => ({ id: t.imageId, key: material!.id }));
      for (const texture of textures) {
        if (materials.has(texture.key)) continue;
        materials.add(texture.key);
        const size = pack.getImageSize(texture.id);
        rules.require(size, 'SEMANTIC', 'texture', texture.id, 'Missing UI texture bytes');
        if (!size) continue;
        rules.require(
          size.width <= context.maxTextureSize &&
            size.height <= context.maxTextureSize &&
            size.width * size.height <= 16_777_216,
          'LIMIT',
          'textureSize',
          size,
          'UI texture exceeds GPU/pixel limit',
        );
        if (!context.cachedMaterialIds.has(texture.key)) pixels += size.width * size.height;
      }
    }
    if (c.dataType === C.SpriteMask) {
      const definition = c.data as R<SpriteMaskT>,
        sprite = pack.document.assets.find((a) => a.id === definition.spriteAssetId)?.sprite;
      if (sprite) {
        vertices += pack.getMesh(sprite.meshAssetId)!.positions.length;
        const key = spriteTextureKey(sprite),
          size = pack.getImageSize(sprite.imageAssetId);
        rules.require(
          size,
          'SEMANTIC',
          'spriteMask.texture',
          sprite.imageAssetId,
          'Missing Sprite Mask texture bytes',
        );
        if (size && !materials.has(key)) {
          materials.add(key);
          rules.require(
            size.width <= context.maxTextureSize &&
              size.height <= context.maxTextureSize &&
              size.width * size.height <= 16_777_216,
            'LIMIT',
            'spriteMask.textureSize',
            size,
            'Sprite Mask texture exceeds GPU/pixel limit',
          );
          if (!context.cachedMaterialIds.has(key)) pixels += size.width * size.height;
        }
      }
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
    if (rendererCanPlay(pack, c.id, c.enabled) && c.dataType === C.ParticleRenderer) {
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
            ...rendererSupport(
              definition,
              material,
              pack,
              system.main!.maxParticles,
              env,
              options.renderEnvironment,
            ),
          );
          vertices += system.main!.maxParticles * rendererVertexStride(definition, pack);
          const sheet = system.modules.find(
            (m) => m.dataType === ParticleModuleData.TextureSheetModule,
          )?.data as R<TextureSheetModuleT> | undefined;
          if (sheet?.mode === 1)
            for (const frame of sheet.spriteAssetIds) {
              const sprite = pack.document.assets.find((a) => a.id === frame)!.sprite!;
              const key = spriteTextureKey(sprite);
              if (materials.has(key)) continue;
              materials.add(key);
              const size = pack.getImageSize(sprite.imageAssetId)!;
              rules.require(
                size.width <= context.maxTextureSize &&
                  size.height <= context.maxTextureSize &&
                  size.width * size.height <= 16_777_216,
                'LIMIT',
                'sprite.textureSize',
                size,
                'Sprite texture exceeds GPU/pixel limit',
              );
              if (!context.cachedMaterialIds.has(key)) pixels += size.width * size.height;
            }
          if (sheet?.mode !== 1 && !materials.has(material.id)) {
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
    if (rendererCanPlay(pack, c.id, c.enabled) && c.dataType === C.SpriteRenderer) {
      const d = c.data as R<SpriteRendererT>;
      const sprite = pack.document.assets.find((a) => a.id === d.spriteAssetId)?.sprite;
      if (sprite && d.materials.some(Boolean)) {
        const geometry = pack.getMesh(sprite.meshAssetId)!;
        let count = geometry.positions.length;
        try {
          count = spriteGeometry(pack, sprite, d).positions.length;
        } catch (error) {
          if (!(error instanceof NatsumeError)) throw error;
          rules.require(false, error.code, 'sprite.geometry', d.spriteAssetId, error.message);
        }
        rules.require(
          count <= 1_000_000,
          'LIMIT',
          'sprite.geometry',
          count,
          'Sprite geometry exceeds vertex budget',
        );
        for (const id of d.materials) {
          if (!id) continue;
          const m = pack.document.materials.find((m) => m.id === id)!;
          rules.issues.push(...materialSupport(m, pack, options.renderEnvironment));
          if (m.model === 4 || m.model === 5)
            rules.require(
              env,
              'HOST',
              'particleEnvironment',
              env,
              'Legacy materials require an explicit particleEnvironment',
            );
          vertices += count;
        }
        const key = spriteTextureKey(sprite);
        if (!materials.has(key)) {
          materials.add(key);
          const size = pack.getImageSize(sprite.imageAssetId)!;
          rules.require(
            size.width <= context.maxTextureSize &&
              size.height <= context.maxTextureSize &&
              size.width * size.height <= 16_777_216,
            'LIMIT',
            'sprite.textureSize',
            size,
            'Sprite texture exceeds GPU/pixel limit',
          );
          if (!context.cachedMaterialIds.has(key)) pixels += size.width * size.height;
        }
      }
    }
    if (rendererCanPlay(pack, c.id, c.enabled) && c.dataType === C.MeshRenderer) {
      const definition = c.data as R<MeshRendererT>;
      const filter = pack.getComponent(definition.meshFilterComponentId)?.data as
        | R<MeshFilterT>
        | undefined;
      const mesh = filter?.meshAssetId ? pack.getMesh(filter.meshAssetId) : undefined;
      const passes = sceneMaterialPasses(definition, mesh);
      if (passes.length) rules.issues.push(...rendererEnvironmentSupport(definition.environment));
      for (const pass of passes) {
        const material = pack.document.materials.find(
          (m) => m.id === definition.materials[pass.slot],
        );
        if (!material) continue;
        rules.issues.push(...materialSupport(material, pack, options.renderEnvironment));
        if (material.model === 4 || material.model === 5)
          rules.require(
            env,
            'HOST',
            'particleEnvironment',
            env,
            'Legacy materials require an explicit particleEnvironment',
          );
        vertices += mesh!.positions.length;
        if (!materials.has(material.id)) {
          materials.add(material.id);
          for (const binding of material.textures) {
            const size = pack.getImageSize(binding.imageId);
            rules.require(
              size,
              'SEMANTIC',
              `materials.${material.id}.texture`,
              binding.imageId,
              'Missing texture bytes',
            );
            if (!size) continue;
            rules.require(
              size.width <= context.maxTextureSize &&
                size.height <= context.maxTextureSize &&
                size.width * size.height <= 16_777_216,
              'LIMIT',
              `materials.${material.id}.textureSize`,
              size,
              'Decoded texture exceeds GPU/pixel limit',
            );
            if (!context.cachedMaterialIds.has(material.id)) pixels += size.width * size.height;
          }
        }
      }
    }
    append(rules.issues, c.id);
  }
  const totals = new SupportChecks();
  const opaqueGroups = new Map<string, Set<number>>();
  for (const c of components) {
    if (
      !rendererCanPlay(pack, c.id, c.enabled) ||
      ![C.ParticleRenderer, C.MeshRenderer].includes(c.dataType)
    )
      continue;
    const renderer = c.data as R<ParticleRendererT> | R<MeshRendererT>;
    const slots =
      c.dataType === C.ParticleRenderer
        ? particleMaterialSlots(renderer as R<ParticleRendererT>)
        : sceneMaterialPasses(
            renderer as R<MeshRendererT>,
            pack.getMesh(
              (
                pack.getComponent((renderer as R<MeshRendererT>).meshFilterComponentId)!
                  .data as R<MeshFilterT>
              ).meshAssetId,
            ),
          ).map((p) => p.slot);
    for (const slot of slots) {
      const material = pack.document.materials.find((m) => m.id === renderer.materials[slot]);
      if (!material || material.renderQueue > 2500) continue;
      const key = `${'sortingLayerRank' in renderer ? renderer.sortingLayerRank : renderer.sortingLayerIndex}/${renderer.sortingOrder}/${material.renderQueue}`;
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
    pixels === 0 || context.imageBitmapAvailable,
    'HOST',
    'createImageBitmap',
    context.imageBitmapAvailable,
    'ImageBitmap decoding is required',
  );
  for (const animation of pack.document.animations)
    totals.issues.push(...animationSupport(animation));
  const writers = new Map<string, Set<string>>(),
    overlaps = new Set<string>();
  const inspectWriter = (writer: string, clipId: number) => {
    for (const track of pack.document.animations.find((a) => a.id === clipId)?.tracks ?? []) {
      const b = track.binding!,
        c = pack.getComponent(b.targetId);
      if (!nodeIds.has(c?.nodeId ?? b.targetId)) continue;
      for (const field of bindingWrites(pack, track)) {
        const owners = writers.get(field) ?? new Set<string>();
        for (const owner of owners) if (owner !== writer) overlaps.add(`${owner} / ${writer}`);
        owners.add(writer);
        writers.set(field, owners);
      }
    }
  };
  for (const c of components)
    if (c.dataType === C.Animator)
      for (const layer of (c.data as R<AnimatorT>).layers)
        for (const state of layer.states) inspectWriter(`animator:${c.id}`, state.animationId);
  for (const action of entry.actions)
    if (action.kind === ActionKind.PlayClip)
      inspectWriter(`clip:${action.animationId}`, action.animationId);
  if (overlaps.size)
    totals.warn(
      'NATSUME_ANIMATION_ORDER',
      'animations.order',
      [...overlaps],
      `Animation writers may overlap: ${[...overlaps].join(', ')}. Default ordering depends on registration; setAnimationPriority selects the final writer.`,
    );
  append(totals.issues);
  return finish();
}
