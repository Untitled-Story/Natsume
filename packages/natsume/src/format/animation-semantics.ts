import { check } from '../errors.js';
import type { DocumentT } from './generated/noa/ir/document.js';
import type { ParticleSystemT } from './generated/noa/ir/particle-system.js';
import type { ParticleRendererT } from './generated/noa/ir/particle-renderer.js';
import type { Vector3TrackT } from './generated/noa/ir/vector3-track.js';
import type { Vector4TrackT } from './generated/noa/ir/vector4-track.js';
import type { ColorTrackT } from './generated/noa/ir/color-track.js';
import type { RotationTrackT } from './generated/noa/ir/rotation-track.js';
import { AnimationProperty as P } from './generated/noa/ir/animation-property.js';
import { ParticleParameter as PP } from './generated/noa/ir/particle-parameter.js';
import { ComponentData as C } from './generated/noa/ir/component-data.js';
import { ParticleModuleData as M } from './generated/noa/ir/particle-module-data.js';
import { TrackData as D } from './generated/noa/ir/track-data.js';
import { RotationEncoding } from './generated/noa/ir/rotation-encoding.js';
import { MaterialModel } from './generated/noa/ir/material-model.js';
import { CustomDataMode } from './generated/noa/ir/custom-data-mode.js';

/** Validates executable animation targets, source branches and feature declarations together. */
export function validateAnimationBindings(d: DocumentT, required: (name: string) => void): void {
  for (const animation of d.animations) {
    const seen = new Set<string>();
    for (const track of animation.tracks) {
      const b = track.binding!,
        c = d.components.find((c) => c.id === b.targetId),
        ps = c?.dataType === C.ParticleSystem ? (c.data as ParticleSystemT) : undefined;
      const identity = `${b.targetId}:${b.property}:${b.parameter}:${b.propertyName}:${b.slotIndex}`;
      check(!seen.has(identity), 'SEMANTIC', 'Conflicting animation bindings');
      seen.add(identity);
      const vector = track.dataType === D.Vector3Track ? (track.data as Vector3TrackT) : undefined;
      const color = track.dataType === D.ColorTrack ? (track.data as ColorTrackT) : undefined;
      const hasVector = !!(vector && (vector.x || vector.y || vector.z));
      const hasColor = !!(color && (color.r || color.g || color.b || color.a));
      let valid = true;
      switch (b.property) {
        case P.NodePosition:
        case P.NodeScale:
          required('animation.transform');
          valid = d.nodes.some((n) => n.id === b.targetId) && hasVector;
          break;
        case P.NodeRotation: {
          required('animation.transform');
          const r = track.data as RotationTrackT;
          valid =
            d.nodes.some((n) => n.id === b.targetId) &&
            track.dataType === D.RotationTrack &&
            !!(r.x || r.y || r.z || r.w) &&
            (r.encoding === RotationEncoding.QuaternionComponents ||
              (r.encoding === RotationEncoding.EulerZXY && !r.w));
          break;
        }
        case P.RectAnchoredPosition:
        case P.RectSizeDelta:
        case P.RectAnchorMin:
        case P.RectAnchorMax:
        case P.RectPivot:
          required('animation.layout');
          valid =
            c?.dataType === C.RectLayout &&
            hasVector &&
            (b.property === P.RectAnchoredPosition || !vector?.z);
          break;
        case P.ComponentEnabled:
        case P.RendererEnabled:
          required('animation.component-enabled');
          valid =
            track.dataType === D.BoolTrack &&
            (c?.dataType === C.ParticleRenderer ||
              (b.property === P.ComponentEnabled && c?.dataType === C.Animator));
          break;
        case P.ParticleLoop:
          required('animation.particle');
          valid = !!ps && track.dataType === D.BoolTrack;
          break;
        case P.ParticleParameter: {
          required('animation.particle');
          valid =
            !!ps &&
            track.dataType === D.FloatTrack &&
            b.parameter >= PP.StartLifetime &&
            b.parameter <= PP.VelocityZ &&
            ['scalar', 'minScalar'].includes(String(b.propertyName));
          if (ps) {
            if ([PP.StartSizeY, PP.StartSizeZ].includes(b.parameter)) valid &&= ps.main!.size3d;
            if ([PP.StartRotationX, PP.StartRotationY].includes(b.parameter))
              valid &&= ps.main!.rotation3d;
            if ([PP.RateOverTime, PP.RateOverDistance].includes(b.parameter))
              valid &&= ps.modules.some((m) => m.dataType === M.EmissionModule);
            if ([PP.VelocityX, PP.VelocityY, PP.VelocityZ].includes(b.parameter))
              valid &&= ps.modules.some((m) => m.dataType === M.VelocityModule);
            if (b.parameter === PP.GravityMultiplier)
              valid &&= !!(ps.main!.gravity || ps.main!.hostGravitySlot);
          }
          break;
        }
        case P.ParticleColor:
        case P.ParticleCustomColor: {
          required('animation.particle');
          valid = !!ps && hasColor && ['minColor', 'maxColor'].includes(String(b.propertyName));
          if (b.property === P.ParticleCustomColor) {
            const custom = ps?.modules.find((m) => m.dataType === M.CustomDataModule)?.data;
            valid &&=
              b.slotIndex <= 1 &&
              !!(
                custom &&
                'streams' in custom &&
                custom.streams.some(
                  (s) => s.slot === b.slotIndex && s.mode === CustomDataMode.Color,
                )
              );
          }
          break;
        }
        case P.RendererMaterialTint:
        case P.RendererMaterialFloat:
        case P.RendererTextureST: {
          required('animation.renderer-material');
          const renderer =
            c?.dataType === C.ParticleRenderer ? (c.data as ParticleRendererT) : undefined;
          const material = d.materials.find((m) => m.id === renderer?.materials[b.slotIndex]);
          valid = !!material && b.slotIndex === 0;
          if (material) {
            if (b.property === P.RendererMaterialTint)
              valid &&=
                hasColor &&
                b.propertyName === '_TintColor' &&
                [
                  MaterialModel.LegacyParticleAdditive,
                  MaterialModel.LegacyParticleAlphaBlend,
                ].includes(material.model);
            else if (b.property === P.RendererMaterialFloat)
              valid &&=
                track.dataType === D.FloatTrack &&
                material.floats.some((f) => f.name === b.propertyName);
            else {
              const v = track.data as Vector4TrackT;
              valid &&=
                track.dataType === D.Vector4Track &&
                !!(v.x || v.y || v.z || v.w) &&
                b.propertyName === '_MainTex' &&
                material.textures.some((t) => t.slot === b.propertyName);
            }
          }
          break;
        }
      }
      check(
        valid,
        'SEMANTIC',
        `Invalid animation binding ${animation.id}:${b.targetId}:${P[b.property]}`,
      );
    }
  }
}
