import { quat, mat3 } from 'gl-matrix';
import { check } from '../errors.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { TrackT } from '../format/generated/noa/ir/track.js';
import type { ScalarCurveT } from '../format/generated/noa/ir/scalar-curve.js';
import type { BoolTrackT } from '../format/generated/noa/ir/bool-track.js';
import type { RotationTrackT } from '../format/generated/noa/ir/rotation-track.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import type { ScalarParameterT } from '../format/generated/noa/ir/scalar-parameter.js';
import { AnimationProperty as P } from '../format/generated/noa/ir/animation-property.js';
import { ParticleParameter as PP } from '../format/generated/noa/ir/particle-parameter.js';
import { RotationEncoding } from '../format/generated/noa/ir/rotation-encoding.js';
import { TrackData } from '../format/generated/noa/ir/track-data.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { ScalarMode } from '../format/generated/noa/ir/scalar-mode.js';
import { curve } from './parameters.js';
import { sampleBool } from './animation.js';
import type { Scene } from './scene.js';

export interface CompiledBinding {
  readonly key: string;
  readonly writes: readonly string[];
  readonly baseline: readonly number[];
  read(): number[];
  write(value: readonly number[]): void;
  sample(seconds: number): void;
}

/** Per-instance numeric state. Source assets and texture leases stay shared and immutable. */
export class AnimationBindings {
  readonly systems = new Map<number, ParticleSystemT>();
  readonly materials = new Map<string, MaterialT>();
  readonly enabled = new Map<number, boolean>();
  private readonly resets: (() => void)[] = [];
  constructor(
    readonly pack: EffectPack,
    readonly scene: Scene,
  ) {
    for (const c of pack.components) this.enabled.set(c.id, c.enabled);
    for (const clip of pack.document.animations)
      for (const track of clip.tracks) {
        const b = track.binding!,
          c = pack.getComponent(b.targetId);
        if (c?.dataType === C.ParticleSystem && !this.systems.has(c.id)) {
          const state = structuredClone(c.data) as ParticleSystemT;
          this.systems.set(c.id, state);
          this.resets.push(() => restore(state, c.data!));
        }
        if (
          c?.dataType === C.ParticleRenderer &&
          [P.RendererMaterialTint, P.RendererMaterialFloat, P.RendererTextureST].includes(
            b.property,
          )
        ) {
          const key = `${c.id}:${b.slotIndex}`;
          if (this.materials.has(key)) continue;
          const source = pack.document.materials.find(
            (m) => m.id === (c.data as R<ParticleRendererT>).materials[b.slotIndex],
          );
          check(source, 'SEMANTIC', 'Missing animated material');
          const state = structuredClone(source) as MaterialT;
          this.materials.set(key, state);
          this.resets.push(() => restore(state, source));
        }
      }
  }
  reset(): void {
    for (const reset of this.resets) reset();
    for (const c of this.pack.components) this.enabled.set(c.id, c.enabled);
  }
  compile(track: R<TrackT>): CompiledBinding | undefined {
    const b = track.binding!,
      component = this.pack.getComponent(b.targetId);
    const n = this.scene.nodes.get(component?.nodeId ?? b.targetId);
    if (!n) return undefined;
    let read: () => number[], write: (v: readonly number[]) => void;
    const vector = (
      target: { x: number; y: number; z?: number; w?: number },
      names: readonly ('x' | 'y' | 'z' | 'w')[],
      changed: () => void,
    ) => {
      read = () => names.map((k) => target[k] ?? 0);
      write = (v) => {
        names.forEach((k, i) => {
          target[k] = v[i]!;
        });
        changed();
      };
    };
    const ps = this.systems.get(b.targetId),
      main = ps?.main;
    switch (b.property) {
      case P.NodeActive:
        read = () => [Number(n.active)];
        write = (v) => {
          n.active = !!v[0];
        };
        break;
      case P.NodePosition:
        vector(n.localPosition, ['x', 'y', 'z'], () => {
          if (n.rect) {
            // Unity couples localPosition and anchoredPosition through the anchor reference.
            const desired = { ...n.localPosition };
            this.scene.update();
            Object.assign(n.localPosition, desired);
            const r = n.rect,
              size = n.parent?.layout,
              pp = n.parent?.rect?.pivot ?? { x: 0.5, y: 0.5 };
            r.anchoredPosition!.x =
              n.localPosition.x -
              (n.parent
                ? (size?.width ?? 0) *
                  (r.anchorMin!.x + (r.anchorMax!.x - r.anchorMin!.x) * r.pivot!.x - pp.x)
                : 0);
            r.anchoredPosition!.y =
              n.localPosition.y -
              (n.parent
                ? (size?.height ?? 0) *
                  (r.anchorMin!.y + (r.anchorMax!.y - r.anchorMin!.y) * r.pivot!.y - pp.y)
                : 0);
            r.anchoredPosition!.z = n.localPosition.z;
          }
          n.transformDirty = true;
        });
        break;
      case P.NodeScale:
        vector(n.localScale, ['x', 'y', 'z'], () => {
          n.transformDirty = true;
        });
        break;
      case P.NodeRotation: {
        const rotation = track.data as R<RotationTrackT>;
        if (rotation.encoding === RotationEncoding.EulerZXY) {
          read = () => quaternionEuler(n.localRotation);
          write = (v) => {
            const q = eulerQuaternion(v);
            Object.assign(n.localRotation, { x: q[0], y: q[1], z: q[2], w: q[3] });
            n.transformDirty = true;
          };
        } else {
          read = () => [n.localRotation.x, n.localRotation.y, n.localRotation.z, n.localRotation.w];
          write = (v) => {
            const norm = Math.hypot(...v);
            Object.assign(
              n.localRotation,
              norm > 1e-12
                ? { x: v[0]! / norm, y: v[1]! / norm, z: v[2]! / norm, w: v[3]! / norm }
                : { x: 0, y: 0, z: 0, w: 1 },
            );
            n.transformDirty = true;
          };
        }
        break;
      }
      case P.RectAnchoredPosition:
      case P.RectSizeDelta:
      case P.RectAnchorMin:
      case P.RectAnchorMax:
      case P.RectPivot: {
        check(n.rect, 'SEMANTIC', 'Missing animated layout');
        const name = (
          {
            [P.RectAnchoredPosition]: 'anchoredPosition',
            [P.RectSizeDelta]: 'sizeDelta',
            [P.RectAnchorMin]: 'anchorMin',
            [P.RectAnchorMax]: 'anchorMax',
            [P.RectPivot]: 'pivot',
          } as const
        )[b.property];
        vector(
          n.rect[name]!,
          b.property === P.RectAnchoredPosition ? ['x', 'y', 'z'] : ['x', 'y'],
          () => {
            n.layoutDirty = true;
          },
        );
        break;
      }
      case P.ComponentEnabled:
      case P.RendererEnabled:
        read = () => [Number(this.enabled.get(b.targetId))];
        write = (v) => {
          this.enabled.set(b.targetId, !!v[0]);
        };
        break;
      case P.ParticleLoop:
        check(main, 'SEMANTIC', 'Missing animated particle system');
        read = () => [Number(main.loop)];
        write = (v) => {
          main.loop = !!v[0];
        };
        break;
      case P.ParticleParameter: {
        check(main && ps, 'SEMANTIC', 'Missing animated particle system');
        const emission = ps.modules.find((m) => m.dataType === M.EmissionModule)?.data;
        const velocity = ps.modules.find((m) => m.dataType === M.VelocityModule)?.data;
        const parameters: Partial<Record<PP, ScalarParameterT | null | undefined>> = {
          [PP.StartLifetime]: main.lifetime,
          [PP.StartSpeed]: main.speed,
          [PP.StartSizeX]: main.size?.x,
          [PP.StartSizeY]: main.size?.y,
          [PP.StartSizeZ]: main.size?.z,
          [PP.StartRotationX]: main.rotation?.x,
          [PP.StartRotationY]: main.rotation?.y,
          [PP.StartRotationZ]: main.rotation?.z,
          [PP.GravityMultiplier]: main.gravityMultiplier,
          [PP.RateOverTime]:
            emission && 'rateOverTime' in emission ? emission.rateOverTime : undefined,
          [PP.RateOverDistance]:
            emission && 'rateOverDistance' in emission ? emission.rateOverDistance : undefined,
          [PP.VelocityX]: velocity && 'linear' in velocity ? velocity.linear?.x : undefined,
          [PP.VelocityY]: velocity && 'linear' in velocity ? velocity.linear?.y : undefined,
          [PP.VelocityZ]: velocity && 'linear' in velocity ? velocity.linear?.z : undefined,
        };
        const parameter = parameters[b.parameter];
        check(parameter, 'SEMANTIC', 'Missing animated particle parameter');
        const field =
          b.propertyName === 'minScalar'
            ? 'constantMin'
            : parameter.mode === ScalarMode.Curve || parameter.mode === ScalarMode.TwoCurves
              ? 'multiplier'
              : 'constantMax';
        read = () => [parameter[field]];
        write = (v) => {
          parameter[field] = v[0]!;
          if (b.parameter === PP.StartSizeX && !main.size3d) {
            main.size!.y![field] = v[0]!;
            main.size!.z![field] = v[0]!;
          }
        };
        break;
      }
      case P.ParticleColor:
      case P.ParticleCustomColor: {
        check(main && ps, 'SEMANTIC', 'Missing animated particle color');
        const custom = ps.modules.find((m) => m.dataType === M.CustomDataModule)?.data;
        const color =
          b.property === P.ParticleColor
            ? main.color
            : custom && 'streams' in custom
              ? custom.streams.find((s) => s.slot === b.slotIndex)?.color
              : undefined;
        const target = b.propertyName === 'minColor' ? color?.colorMin : color?.colorMax;
        check(target, 'SEMANTIC', 'Missing animated color endpoint');
        read = () => [target.r, target.g, target.b, target.a];
        write = (v) => {
          [target.r, target.g, target.b, target.a] = v as [number, number, number, number];
        };
        break;
      }
      case P.RendererMaterialTint:
      case P.RendererMaterialFloat:
      case P.RendererTextureST: {
        const material = this.materials.get(`${b.targetId}:${b.slotIndex}`);
        check(material, 'SEMANTIC', 'Missing renderer material override');
        if (b.property === P.RendererMaterialTint) {
          const c = material.tint!;
          read = () => [c.r, c.g, c.b, c.a];
          write = (v) => {
            [c.r, c.g, c.b, c.a] = v as [number, number, number, number];
          };
        } else if (b.property === P.RendererMaterialFloat) {
          const f = material.floats.find((f) => f.name === b.propertyName);
          check(f, 'SEMANTIC', 'Missing animated material float');
          read = () => [f.value];
          write = (v) => {
            f.value = v[0]!;
          };
        } else {
          const t = material.textures.find((t) => t.slot === b.propertyName);
          check(t?.scale && t.offset, 'SEMANTIC', 'Missing animated texture transform');
          read = () => [t.scale!.x, t.scale!.y, t.offset!.x, t.offset!.y];
          write = (v) => {
            [t.scale!.x, t.scale!.y, t.offset!.x, t.offset!.y] = v as [
              number,
              number,
              number,
              number,
            ];
          };
        }
        break;
      }
      default:
        check(false, 'CAPABILITY', 'Unsupported animation binding');
    }
    const baseline = read!(),
      channels = track.data as unknown as Record<string, R<ScalarCurveT> | null>;
    const names =
      track.dataType === TrackData.FloatTrack
        ? ['curve']
        : track.dataType === TrackData.ColorTrack
          ? ['r', 'g', 'b', 'a']
          : ['x', 'y', 'z', 'w'].slice(0, baseline.length);
    const samplers = names.map((k) => channels[k]);
    const values = [...baseline];
    return {
      key: `${b.targetId}:${b.property}:${b.parameter}:${b.propertyName}:${b.slotIndex}`,
      writes: bindingWrites(this.pack, track),
      baseline,
      read: read!,
      write: write!,
      sample: (seconds) => {
        if (track.dataType === TrackData.BoolTrack)
          values[0] = Number(
            sampleBool((track.data as R<BoolTrackT>).keys, seconds) ?? !!baseline[0],
          );
        else
          for (let i = 0; i < baseline.length; i++)
            values[i] = samplers[i] ? curve(samplers[i], seconds) : baseline[i]!;
        write!(values);
      },
    };
  }
}

/** Restores leaves in place, preserving references held by emitters and draw passes. */
function restore(target: object, source: object): void {
  for (const [key, value] of Object.entries(source)) {
    const t = target as Record<string, unknown>;
    if (value && typeof value === 'object' && t[key] && typeof t[key] === 'object')
      restore(t[key] as object, value);
    else t[key] = value;
  }
}
export function eulerQuaternion(v: readonly number[]): quat {
  const [x, y, z] = v.map((v) => v / 2),
    sx = Math.sin(x!),
    cx = Math.cos(x!),
    sy = Math.sin(y!),
    cy = Math.cos(y!),
    sz = Math.sin(z!),
    cz = Math.cos(z!);
  return quat.fromValues(
    cy * sx * cz + sy * cx * sz,
    sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz,
    cy * cx * cz + sy * sx * sz,
  );
}
function quaternionEuler(q: { x: number; y: number; z: number; w: number }): number[] {
  const m = mat3.fromQuat(mat3.create(), [q.x, q.y, q.z, q.w]);
  const x = Math.asin(Math.max(-1, Math.min(1, -m[7]!)));
  return Math.abs(Math.cos(x)) > 1e-6
    ? [x, Math.atan2(m[6]!, m[8]!), Math.atan2(m[1]!, m[4]!)]
    : [x, Math.atan2(-m[2]!, m[0]!), 0];
}

/** Physical write identities include aliases and uniform size axes. */
export function bindingWrites(pack: EffectPack, track: R<TrackT>): readonly string[] {
  const b = track.binding!,
    component = pack.getComponent(b.targetId),
    nodeId = component?.nodeId ?? b.targetId;
  if (b.property === P.NodePosition || b.property === P.RectAnchoredPosition)
    return [`node:${nodeId}:position`];
  if (b.property === P.NodeScale || b.property === P.NodeRotation)
    return [`node:${nodeId}:${b.property}`];
  if (b.property === P.ComponentEnabled || b.property === P.RendererEnabled)
    return [`component:${b.targetId}:enabled`];
  const key = `${b.targetId}:${b.property}:${b.parameter}:${b.propertyName}:${b.slotIndex}`;
  if (
    b.property === P.ParticleParameter &&
    b.parameter === PP.StartSizeX &&
    component?.dataType === C.ParticleSystem &&
    !(component.data as R<ParticleSystemT>).main!.size3d
  )
    return [PP.StartSizeX, PP.StartSizeY, PP.StartSizeZ].map(
      (p) => `${b.targetId}:${b.property}:${p}:${b.propertyName}:${b.slotIndex}`,
    );
  return [key];
}
