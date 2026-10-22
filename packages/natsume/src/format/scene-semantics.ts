import { check } from '../errors.js';
import type { DocumentT } from './generated/noa/ir/document.js';
import { AssetKind as A } from './generated/noa/ir/asset-kind.js';
import { ComponentData as C } from './generated/noa/ir/component-data.js';
import { MaterialModel as M } from './generated/noa/ir/material-model.js';
import { DepthTestSource } from './generated/noa/ir/depth-test-source.js';
import type { RenderEnvironmentT } from './generated/noa/ir/render-environment.js';
import type { MeshFilterT } from './generated/noa/ir/mesh-filter.js';
import type { MeshRendererT } from './generated/noa/ir/mesh-renderer.js';
import type { SpriteRendererT } from './generated/noa/ir/sprite-renderer.js';
import type { SpriteMaskT } from './generated/noa/ir/sprite-mask.js';
import type { CanvasT } from './generated/noa/ir/canvas.js';
import type { UIImageT } from './generated/noa/ir/uiimage.js';
import type { UIMaskT } from './generated/noa/ir/uimask.js';
import type { RectMask2DT } from './generated/noa/ir/rect-mask2-d.js';
import type { CanvasGroupT } from './generated/noa/ir/canvas-group.js';
import type { ParticleRendererT } from './generated/noa/ir/particle-renderer.js';
import type { ParticleSystemT } from './generated/noa/ir/particle-system.js';
import { ParticleModuleData as P } from './generated/noa/ir/particle-module-data.js';
import type { TextureSheetModuleT } from './generated/noa/ir/texture-sheet-module.js';
import type { ShapeModuleT } from './generated/noa/ir/shape-module.js';
import { ShapeGeometry as G } from './generated/noa/ir/shape-geometry.js';
import type { SpriteShapeT } from './generated/noa/ir/sprite-shape.js';
import type { DonutShapeT } from './generated/noa/ir/donut-shape.js';

/** Validates scene and asset contracts without claiming GPU execution support. */
export function validateSceneAssets(
  d: DocumentT,
  required: (name: string, revision?: number) => void,
): void {
  const assets = new Map(d.assets.map((a) => [a.id, a]));
  const components = new Map(d.components.map((c) => [c.id, c]));
  const materialIds = new Set(d.materials.map((m) => m.id));
  const asset = (id: number, kind: A, optional = false) =>
    check(
      (optional && id === 0) || assets.get(id)?.kind === kind,
      'SEMANTIC',
      'Invalid asset kind or reference ' + id,
    );
  const materials = (ids: number[]) =>
    check(
      ids.every((id) => id === 0 || materialIds.has(id)),
      'SEMANTIC',
      'Invalid renderer material reference',
    );
  const mask = (value: number) => {
    check([0, 1, 2].includes(value), 'SEMANTIC', 'Invalid mask interaction');
    if (value !== 0) required('render.sprite-mask');
  };
  const environment = (e: RenderEnvironmentT | null) => {
    if (!e) return;
    check(
      e.castShadows <= 3 && e.lightProbes <= 2 && e.reflectionProbes <= 3,
      'SEMANTIC',
      'Invalid render environment',
    );
    if (e.castShadows || e.receiveShadows || e.lightProbes || e.reflectionProbes)
      required('render.environment');
  };
  const onNode = (nodeId: number, kind: C) =>
    d.components.some((c) => c.nodeId === nodeId && c.dataType === kind);
  for (const a of d.assets) {
    check(a.kind !== A.Unknown, 'SEMANTIC', 'Unknown asset kind');
    if (a.kind === A.Mesh) required('mesh.noms', 2);
    if (a.kind !== A.Sprite) {
      check(!a.sprite, 'SEMANTIC', 'Sprite descriptor on wrong asset kind');
      continue;
    }
    required('asset.sprite');
    const s = a.sprite;
    check(s, 'SEMANTIC', 'Missing Sprite descriptor');
    asset(s.meshAssetId, A.Mesh);
    asset(s.imageAssetId, A.Image);
    check(
      s.pixelsPerUnit > 0 &&
        s.downscaleMultiplier > 0 &&
        s.rect &&
        s.pivot &&
        s.border &&
        s.textureRect &&
        s.sampler,
      'SEMANTIC',
      'Invalid or incomplete Sprite metadata',
    );
    check(s.rect.z > 0 && s.rect.w > 0, 'SEMANTIC', 'Invalid Sprite rect');
    // A source pivot outside [0,1] is valid and must remain unchanged.
  }
  for (const c of d.components) {
    if ([C.MeshRenderer, C.SpriteRenderer, C.UIImage].includes(c.dataType)) {
      required('color.authored');
      check(d.colorContext, 'SEMANTIC', 'Renderer needs a color context');
    }
    if ([C.Canvas, C.UIImage, C.RectMask2D].includes(c.dataType))
      check(onNode(c.nodeId, C.RectLayout), 'SEMANTIC', 'UI component needs RectLayout');
    switch (c.dataType) {
      case C.MeshFilter: {
        required('scene.mesh-renderer');
        asset((c.data as MeshFilterT).meshAssetId, A.Mesh, true);
        break;
      }
      case C.MeshRenderer: {
        required('scene.mesh-renderer');
        const r = c.data as MeshRendererT,
          f = components.get(r.meshFilterComponentId);
        check(
          f?.nodeId === c.nodeId && f.dataType === C.MeshFilter,
          'SEMANTIC',
          'MeshRenderer needs its own MeshFilter',
        );
        materials(r.materials);
        environment(r.environment);
        break;
      }
      case C.SpriteRenderer: {
        required('scene.sprite-renderer');
        const r = c.data as SpriteRendererT;
        asset(r.spriteAssetId, A.Sprite, true);
        materials(r.materials);
        mask(r.maskInteraction);
        check(
          r.color &&
            r.size &&
            r.size.x >= 0 &&
            r.size.y >= 0 &&
            r.tileMode <= 1 &&
            r.adaptiveModeThreshold >= 0 &&
            r.adaptiveModeThreshold <= 1,
          'SEMANTIC',
          'Invalid SpriteRenderer',
        );
        break;
      }
      case C.SpriteMask: {
        required('render.sprite-mask');
        const m = c.data as SpriteMaskT;
        asset(m.spriteAssetId, A.Sprite, true);
        check(m.alphaCutoff >= 0 && m.alphaCutoff <= 1, 'SEMANTIC', 'Invalid SpriteMask cutoff');
        check(
          !m.customRange ||
            m.backLayerIndex < m.frontLayerIndex ||
            (m.backLayerIndex === m.frontLayerIndex && m.backOrder <= m.frontOrder),
          'SEMANTIC',
          'Inverted SpriteMask sorting range',
        );
        break;
      }
      case C.ParticleRenderer: {
        const r = c.data as ParticleRendererT;
        mask(r.maskInteraction);
        environment(r.environment);
        if (r.mode === 5) required('particle.renderer-none');
        break;
      }
      case C.ParticleSystem:
        for (const m of (c.data as ParticleSystemT).modules) {
          if (m.dataType === P.TextureSheetModule) {
            const s = m.data as TextureSheetModuleT;
            if (s.mode === 1) {
              required('particle.texture-sheet-sprites');
              check(s.spriteAssetIds.length > 0, 'SEMANTIC', 'Empty Sprite sheet');
              for (const id of s.spriteAssetIds) asset(id, A.Sprite);
            }
          }
          if (m.dataType === P.ShapeModule) {
            const s = m.data as ShapeModuleT;
            if (s.geometryType === G.SpriteShape) {
              const g = s.geometry as SpriteShapeT;
              asset(g.spriteAssetId, A.Sprite);
              check(
                g.spawnSpread >= 0 && g.spawnSpread <= 1 && g.spawnSpeed,
                'SEMANTIC',
                'Invalid Sprite shape sweep',
              );
            }
            if (s.geometryType === G.DonutShape) {
              const g = s.geometry as DonutShapeT;
              check(
                g.radius >= 0 &&
                  g.tubeRadius >= 0 &&
                  g.radiusThickness >= 0 &&
                  g.radiusThickness <= 1 &&
                  g.arcRadians >= 0 &&
                  g.arcRadians <= 2 * Math.PI + 2e-7 &&
                  g.arcSpread >= 0 &&
                  g.arcSpread <= 1 &&
                  g.arcSpeed,
                'SEMANTIC',
                'Invalid Donut shape',
              );
            }
          }
        }
        break;
      case C.Canvas: {
        required('ui.canvas');
        const v = c.data as CanvasT;
        check(
          v.planeDistance >= 0 && (v.additionalShaderChannels & ~31) === 0,
          'SEMANTIC',
          'Invalid Canvas plane or channels',
        );
        check(
          v.cameraComponentId === 0 || components.get(v.cameraComponentId)?.dataType === C.Camera,
          'SEMANTIC',
          'Invalid Canvas camera',
        );
        check(
          v.mode !== 1 || v.cameraComponentId !== 0 || v.hostCameraSlot,
          'SEMANTIC',
          'Canvas needs host camera',
        );
        break;
      }
      case C.UIImage: {
        required('ui.canvas');
        const i = c.data as UIImageT;
        asset(i.spriteAssetId, A.Sprite, true);
        asset(i.overrideSpriteAssetId, A.Sprite, true);
        materials([i.materialId]);
        check(
          i.color &&
            i.fillMethod <= 4 &&
            i.fillOrigin <= 3 &&
            i.fillAmount >= 0 &&
            i.fillAmount <= 1 &&
            i.pixelsPerUnitMultiplier > 0,
          'SEMANTIC',
          'Invalid UIImage',
        );
        check(onNode(c.nodeId, C.CanvasRenderer), 'SEMANTIC', 'UIImage needs CanvasRenderer');
        break;
      }
      case C.UIMask: {
        required('ui.canvas');
        const id = (c.data as UIMaskT).graphicComponentId,
          g = components.get(id);
        check(
          id === 0 || (g?.nodeId === c.nodeId && g.dataType === C.UIImage),
          'SEMANTIC',
          'UIMask needs its own UIImage',
        );
        break;
      }
      case C.RectMask2D: {
        required('ui.canvas');
        const m = c.data as RectMask2DT;
        check(
          m.padding && m.softness && m.softness.x >= 0 && m.softness.y >= 0,
          'SEMANTIC',
          'Invalid RectMask2D',
        );
        break;
      }
      case C.CanvasGroup: {
        required('ui.canvas');
        const a = (c.data as CanvasGroupT).alpha;
        check(a >= 0 && a <= 1, 'SEMANTIC', 'Invalid CanvasGroup alpha');
        break;
      }
      case C.CanvasRenderer:
        required('ui.canvas');
        break;
    }
  }
  for (const m of d.materials) {
    const feature = (
      {
        [M.SpriteDefault]: 'material.unity-sprite-default',
        [M.UIDefault]: 'material.unity-ui-default',
        [M.TextureVertexColor]: 'material.texture-vertex-color',
      } as Record<number, string>
    )[m.model];
    if (feature) {
      required(feature);
      check(m.shaderDataAssetId > 0, 'SEMANTIC', 'Material requires a shader recipe');
    }
    const s = m.renderState!;
    check(
      s.depthTestSource === DepthTestSource.Fixed ||
        (s.depthTestSource === DepthTestSource.Canvas && m.model === M.UIDefault),
      'SEMANTIC',
      'Invalid material depth source',
    );
  }
}
