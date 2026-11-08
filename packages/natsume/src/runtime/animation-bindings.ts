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
import {
  sourceAnimationTarget,
  sourceAnimationMetadata,
  sourceFieldBaseline,
} from './source-animation.js';
import { ColorT } from '../format/generated/noa/ir/color.js';
import { assertSupport } from './support-checks.js';
import {
  scriptFieldBaseline,
  validScriptField,
  animatedScriptFieldValue,
  type ScriptFieldResolver,
  type ScriptFieldValue,
} from './script-fields.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';

export interface CompiledBinding {
  readonly key: string;
  readonly writes: readonly string[];
  readonly baseline: readonly number[];
  readonly mask: readonly boolean[];
  readonly discrete: boolean;
  readonly rotation: 'euler' | 'quaternion' | undefined;
  evaluate(seconds: number): readonly number[];
  read(): number[];
  write(value: readonly number[]): void;
  sample(seconds: number): void;
}

/** Per-instance numeric state. Source assets and texture leases stay shared and immutable. */
export class AnimationBindings {
  readonly cameras = new Map<number, import('../format/generated/noa/ir/camera.js').CameraT>();
  readonly systems = new Map<number, ParticleSystemT>();
  readonly materials = new Map<string, MaterialT>();
  readonly spriteColors = new Map<number, import('../format/generated/noa/ir/color.js').ColorT>();
  readonly imageColors = new Map<number, import('../format/generated/noa/ir/color.js').ColorT>();
  private readonly dormantColors = new Map<string, number>();
  readonly scriptFields = new Map<number, Record<string, ScriptFieldValue>>();
  readonly pendingScriptFields = new Map<number, Map<string, ScriptFieldValue>>();
  readonly enabled = new Map<number, boolean>();
  private readonly resets: (() => void)[] = [];
  constructor(
    readonly pack: EffectPack,
    readonly scene: Scene,
    private readonly resolveScriptField?: ScriptFieldResolver,
  ) {
    for (const c of pack.components) {
      this.enabled.set(c.id, c.enabled);
      if (c.dataType === C.CustomComponent) {
        const component = c.data as R<CustomComponentT>;
        const fields: Record<string, ScriptFieldValue> = Object.create(null);
        this.scriptFields.set(c.id, fields);
        for (const field of component.fields) {
          const name = String(field.name),
            type = resolveScriptField?.(component, name);
          const baseline = scriptFieldBaseline(component, name);
          if (!validScriptField(type, baseline)) continue;
          fields[name] = baseline!;
          this.resets.push(() => this.writeScriptField(c.id, name, baseline!));
        }
      }
      if (c.dataType === C.Camera) {
        const state = structuredClone(
          c.data,
        ) as import('../format/generated/noa/ir/camera.js').CameraT;
        this.cameras.set(c.id, state);
        this.resets.push(() => restore(state, c.data!));
      }
    }
    for (const clip of pack.document.animations)
      for (const track of clip.tracks) {
        const b = track.binding!,
          source = b.property === P.SourceBinding ? sourceAnimationTarget(pack, track) : undefined,
          c = pack.getComponent(source?.componentId || b.targetId);
        if (source?.kind === 'custom-color') {
          const key = `${source.componentId}:${source.field}`;
          const baseline = sourceAnimationMetadata(pack, track, source).baseline;
          if (baseline !== undefined && !this.dormantColors.has(key)) {
            this.dormantColors.set(key, baseline);
            this.resets.push(() => {
              this.dormantColors.set(key, baseline);
            });
          }
        }
        if (source?.kind === 'image-color' && c && !this.imageColors.has(c.id)) {
          const original = (c.data as R<import('../format/generated/noa/ir/uiimage.js').UIImageT>)
            .color!;
          const state = structuredClone(
            original,
          ) as import('../format/generated/noa/ir/color.js').ColorT;
          this.imageColors.set(c.id, state);
          this.resets.push(() => Object.assign(state, original));
        }
        if (c?.dataType === C.ParticleSystem && !this.systems.has(c.id)) {
          const state = structuredClone(c.data) as ParticleSystemT;
          this.systems.set(c.id, state);
          this.resets.push(() => restore(state, c.data!));
        }
        if (c?.dataType === C.ParticleSystem && b.property === P.ParticleColor) {
          const color = this.systems.get(c.id)!.main!.color!,
            endpoint = b.propertyName === 'minColor' ? 'colorMin' : 'colorMax';
          if (!color[endpoint]) {
            const channels = ['r', 'g', 'b', 'a'] as const;
            const values = channels.map((channel) =>
              sourceFieldBaseline(
                pack,
                c.id,
                `InitialModule.startColor.${b.propertyName}.${channel}`,
              ),
            );
            if (values.every((v) => v !== undefined)) {
              const baseline = new ColorT(values[0]!, values[1]!, values[2]!, values[3]!);
              const state = structuredClone(baseline);
              color[endpoint] = state;
              // Restore after the source reset, which leaves this dormant endpoint null.
              this.resets.push(() => {
                Object.assign(state, baseline);
                color[endpoint] = state;
              });
            }
          }
        }
        if (
          c?.dataType === C.SpriteRenderer &&
          b.property === P.SpriteColor &&
          !this.spriteColors.has(c.id)
        ) {
          const original = (
            c.data as R<import('../format/generated/noa/ir/sprite-renderer.js').SpriteRendererT>
          ).color!;
          const state = structuredClone(
            original,
          ) as import('../format/generated/noa/ir/color.js').ColorT;
          this.spriteColors.set(c.id, state);
          this.resets.push(() => Object.assign(state, original));
        }
        if (
          c &&
          [C.ParticleRenderer, C.MeshRenderer, C.SpriteRenderer].includes(c.dataType) &&
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
    this.pendingScriptFields.clear();
    for (const reset of this.resets) reset();
    for (const c of this.pack.components) this.enabled.set(c.id, c.enabled);
  }
  private writeScriptField(id: number, name: string, value: ScriptFieldValue): void {
    const fields = this.scriptFields.get(id)!;
    if (Object.is(fields[name], value)) return;
    fields[name] = value;
    let pending = this.pendingScriptFields.get(id);
    if (!pending) this.pendingScriptFields.set(id, (pending = new Map()));
    pending.set(name, value);
  }
  compile(track: R<TrackT>): CompiledBinding | undefined {
    const b = track.binding!,
      source = b.property === P.SourceBinding ? sourceAnimationTarget(this.pack, track) : undefined,
      component = this.pack.getComponent(source?.componentId || b.targetId);
    if (source) {
      assertSupport(source.issues);
      if (source.kind === 'unbound') return undefined;
    }
    const n = this.scene.nodes.get(source?.nodeId ?? component?.nodeId ?? b.targetId);
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
    const ps = this.systems.get(source?.componentId || b.targetId),
      main = ps?.main;
    switch (b.property) {
      case P.SourceBinding: {
        check(source, 'SEMANTIC', 'Missing source animation identity');
        if (source.kind === 'active') {
          read = () => [Number(n.active)];
          write = (v) => {
            n.active = v[0] !== 0;
          };
        } else if (source.kind === 'image-color') {
          const color = this.imageColors.get(source.componentId),
            channel = source.channel!;
          check(color, 'SEMANTIC', 'Missing animated Image color');
          read = () => [color[channel]];
          write = (v) => {
            color[channel] = v[0]!;
          };
        } else if (source.kind === 'burst-count') {
          const emission = ps?.modules.find((m) => m.dataType === M.EmissionModule)?.data;
          const parameter =
            emission && 'bursts' in emission ? emission.bursts[source.slot!]?.count : undefined;
          check(parameter, 'SEMANTIC', 'Missing animated burst count');
          const field =
            parameter.mode === ScalarMode.Curve || parameter.mode === ScalarMode.TwoCurves
              ? 'multiplier'
              : 'constantMax';
          read = () => [parameter[field]];
          write = (v) => {
            parameter[field] = v[0]!;
          };
        } else if (source.kind === 'custom-color') {
          const custom = ps?.modules.find((m) => m.dataType === M.CustomDataModule)?.data;
          const color =
            custom && 'streams' in custom
              ? custom.streams.find((s) => s.slot === source.slot)?.color?.colorMax
              : undefined;
          const channel = source.channel!,
            key = `${source.componentId}:${source.field}`;
          check(
            color || this.dormantColors.has(key),
            'CAPABILITY',
            'Source custom color baseline is unavailable',
          );
          read = () => [color ? color[channel] : this.dormantColors.get(key)!];
          write = (v) => {
            if (color) color[channel] = v[0]!;
            else this.dormantColors.set(key, v[0]!);
          };
        } else if (source.kind === 'script-field') {
          const component = this.pack.getComponent(source.componentId)!.data as R<CustomComponentT>;
          const type = this.resolveScriptField?.(component, source.field);
          const fields = this.scriptFields.get(source.componentId);
          check(
            type && fields && source.field in fields,
            'HOST',
            'Missing Bridge field declaration',
          );
          const integerBits = sourceAnimationMetadata(this.pack, track, source).isIntCurve === true;
          read = () => [Number(fields[source.field])];
          write = (v) =>
            this.writeScriptField(
              source.componentId,
              source.field,
              animatedScriptFieldValue(type, v[0]!, integerBits),
            );
        } else {
          check(false, 'CAPABILITY', 'Source field execution is not implemented');
        }
        break;
      }
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
      case P.CameraActive:
        read = () => [Number(this.enabled.get(b.targetId))];
        write = (v) => {
          this.enabled.set(b.targetId, !!v[0]);
        };
        break;
      case P.CameraFov:
      case P.CameraOrthoSize:
      case P.CameraNear:
      case P.CameraFar: {
        const camera = this.cameras.get(b.targetId);
        check(camera, 'SEMANTIC', 'Missing animated Camera');
        const field = (
          {
            [P.CameraFov]: 'fovRadians',
            [P.CameraOrthoSize]: 'orthoHalfHeight',
            [P.CameraNear]: 'nearPlane',
            [P.CameraFar]: 'farPlane',
          } as const
        )[b.property];
        read = () => [camera[field]];
        write = (v) => {
          camera[field] = v[0]!;
        };
        break;
      }
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
      case P.SpriteColor: {
        const c = this.spriteColors.get(b.targetId);
        check(c, 'SEMANTIC', 'Missing animated Sprite color');
        read = () => [c.r, c.g, c.b, c.a];
        write = (v) => {
          [c.r, c.g, c.b, c.a] = v as [number, number, number, number];
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
    const intBits =
      source?.kind === 'script-field' &&
      sourceAnimationMetadata(this.pack, track, source).isIntCurve;
    const bits = intBits ? new DataView(new ArrayBuffer(4)) : undefined;
    const evaluate = (seconds: number): readonly number[] => {
      if (track.dataType === TrackData.BoolTrack)
        values[0] = Number(
          sampleBool((track.data as R<BoolTrackT>).keys, seconds) ?? !!baseline[0],
        );
      else
        for (let i = 0; i < baseline.length; i++)
          values[i] = samplers[i] ? curve(samplers[i], seconds) : baseline[i]!;
      if (bits) {
        bits.setFloat32(0, values[0]!, true);
        values[0] = bits.getInt32(0, true);
      }
      return values;
    };
    return {
      key: source
        ? `source:${source.nodeId}:${source.componentId}:${source.field}`
        : `${b.targetId}:${b.property}:${b.parameter}:${b.propertyName}:${b.slotIndex}`,
      writes: bindingWrites(this.pack, track),
      baseline,
      mask: track.dataType === TrackData.BoolTrack ? [true] : samplers.map((s) => !!s),
      discrete: track.dataType === TrackData.BoolTrack,
      rotation:
        b.property === P.NodeRotation
          ? (track.data as R<RotationTrackT>).encoding === RotationEncoding.EulerZXY
            ? 'euler'
            : 'quaternion'
          : undefined,
      read: read!,
      write: write!,
      evaluate,
      sample: (seconds) => {
        write!(evaluate(seconds));
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
export function quaternionEuler(q: { x: number; y: number; z: number; w: number }): number[] {
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
  if (b.property === P.SourceBinding) {
    const source = sourceAnimationTarget(pack, track);
    if (source.kind === 'unbound') return [];
    if (source.kind === 'active') return [`node:${source.nodeId}:active`];
    return [`source:${source.nodeId}:${source.componentId}:${source.field}`];
  }
  if (b.property === P.NodeActive) return [`node:${nodeId}:active`];
  if (b.property === P.NodePosition || b.property === P.RectAnchoredPosition)
    return [`node:${nodeId}:position`];
  if (b.property === P.NodeScale || b.property === P.NodeRotation)
    return [`node:${nodeId}:${b.property}`];
  if (
    b.property === P.ComponentEnabled ||
    b.property === P.RendererEnabled ||
    b.property === P.CameraActive
  )
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
