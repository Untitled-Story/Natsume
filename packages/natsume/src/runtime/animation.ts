import { TrackData } from '../format/generated/noa/ir/track-data.js';
import type { EffectPack } from '../pack.js';
import type { DeepReadonly as R } from '../pack.js';
import type { AnimationT } from '../format/generated/noa/ir/animation.js';
import type { AnimatorT } from '../format/generated/noa/ir/animator.js';
import type { BoolKeyT } from '../format/generated/noa/ir/bool-key.js';
import { AnimationProperty } from '../format/generated/noa/ir/animation-property.js';
import { ParticleModuleData } from '../format/generated/noa/ir/particle-module-data.js';
import { SupportChecks, type SupportIssue } from './support-checks.js';
import {
  sourceAnimationTarget,
  sourceAnimationMetadata,
  sourceFieldBaseline,
} from './source-animation.js';
import {
  scriptFieldBaseline,
  validScriptField,
  type ScriptFieldResolver,
} from './script-fields.js';

/** Native Animator state time is accumulated in normalized Float32 units. */
export class AnimationClock {
  normalizedTime = 0;
  constructor(
    readonly duration: number,
    readonly loop: boolean,
    readonly speed = 1,
    readonly cycleOffset = 0,
  ) {}
  get seconds(): number {
    if (this.duration === 0) return 0;
    let phase = this.normalizedTime;
    if (this.loop) {
      phase = Math.fround(phase + this.cycleOffset);
      phase -= Math.floor(phase);
    } else phase = Math.max(0, Math.min(1, phase));
    return Math.fround(phase * this.duration);
  }
  advance(seconds: number): void {
    if (this.duration > 0)
      this.normalizedTime = Math.fround(
        this.normalizedTime + Math.fround(Math.fround(seconds * this.speed) / this.duration),
      );
  }
}

/** Clamps outside the keyed range; an empty track preserves the entry baseline. */
export function sampleBool(keys: readonly R<BoolKeyT>[], seconds: number): boolean | undefined {
  let lo = 0,
    hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]!.time <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return keys[Math.max(0, lo - 1)]?.value;
}

/** Shared by preflight and execution; schema availability does not imply track support. */
export function animationSupport(
  animation: R<AnimationT>,
  pack?: EffectPack,
  scriptFields?: ScriptFieldResolver,
): readonly SupportIssue[] {
  const rules = new SupportChecks();
  const path = `animations.${animation.id}`;
  const supported = new Set([
    AnimationProperty.NodeActive,
    AnimationProperty.NodePosition,
    AnimationProperty.NodeRotation,
    AnimationProperty.NodeScale,
    AnimationProperty.RectAnchoredPosition,
    AnimationProperty.RectSizeDelta,
    AnimationProperty.RectAnchorMin,
    AnimationProperty.RectAnchorMax,
    AnimationProperty.RectPivot,
    AnimationProperty.ComponentEnabled,
    AnimationProperty.RendererEnabled,
    AnimationProperty.ParticleParameter,
    AnimationProperty.ParticleColor,
    AnimationProperty.ParticleCustomColor,
    AnimationProperty.ParticleLoop,
    AnimationProperty.RendererMaterialTint,
    AnimationProperty.RendererMaterialFloat,
    AnimationProperty.RendererTextureST,
    AnimationProperty.SpriteColor,
    AnimationProperty.CameraFov,
    AnimationProperty.CameraOrthoSize,
    AnimationProperty.CameraNear,
    AnimationProperty.CameraFar,
    AnimationProperty.CameraActive,
  ]);
  for (const [index, track] of animation.tracks.entries()) {
    if (track.binding?.property === AnimationProperty.ParticleColor && pack) {
      const component = pack.getComponent(track.binding.targetId);
      const system = component?.data as
        | R<import('../format/generated/noa/ir/particle-system.js').ParticleSystemT>
        | undefined;
      const endpoint = track.binding.propertyName === 'minColor' ? 'colorMin' : 'colorMax';
      rules.require(
        system?.main?.color?.[endpoint] ||
          ['r', 'g', 'b', 'a'].every(
            (channel) =>
              sourceFieldBaseline(
                pack,
                track.binding!.targetId,
                `InitialModule.startColor.${track.binding!.propertyName}.${channel}`,
              ) !== undefined,
          ),
        'CAPABILITY',
        `${path}.tracks.${index}.binding`,
        track.binding,
        'Animated particle color baseline is unavailable',
      );
    }
    if (track.binding?.property === AnimationProperty.SourceBinding && pack) {
      const target = sourceAnimationTarget(pack, track);
      rules.issues.push(
        ...target.issues.map((issue) => ({
          ...issue,
          field: `${path}.tracks.${index}.${issue.field}`,
        })),
      );
      if (target.kind === 'script-field') {
        const component = pack.getComponent(target.componentId)!.data as R<
          import('../format/generated/noa/ir/custom-component.js').CustomComponentT
        >;
        const type = scriptFields?.(component, target.field);
        rules.require(
          validScriptField(type, scriptFieldBaseline(component, target.field)),
          'HOST',
          `${path}.tracks.${index}.binding.source`,
          track.binding.source,
          'Animated script field requires a matching Bridge field declaration',
        );
        rules.require(
          type === undefined ||
            sourceAnimationMetadata(pack, track, target).isIntCurve !== undefined,
          'CAPABILITY',
          `${path}.tracks.${index}.binding.source.isIntCurve`,
          track.binding.source,
          'Source script curve storage type is unavailable or ambiguous',
        );
      }
      if (target.kind === 'custom-color') {
        const component = pack.getComponent(target.componentId);
        const system = component?.data as
          | R<import('../format/generated/noa/ir/particle-system.js').ParticleSystemT>
          | undefined;
        const custom = system?.modules.find(
          (m) => m.dataType === ParticleModuleData.CustomDataModule,
        )?.data;
        const color =
          custom && 'streams' in custom
            ? custom.streams.find((s) => s.slot === target.slot)?.color?.colorMax
            : undefined;
        rules.require(
          color || sourceAnimationMetadata(pack, track, target).baseline !== undefined,
          'CAPABILITY',
          `${path}.tracks.${index}.binding.source`,
          track.binding.source,
          'Source custom color baseline is unavailable',
        );
      }
      continue;
    }
    rules.require(
      supported.has(track.binding!.property) &&
        (track.binding!.property !== AnimationProperty.NodeActive ||
          track.dataType === TrackData.BoolTrack),
      'CAPABILITY',
      `${path}.tracks.${index}`,
      [track.binding?.property, track.dataType],
      'Unsupported animation property',
    );
  }
  return rules.issues;
}

/** The validated flat controller contract is executable, including empty controllers and motions. */
export function animatorSupport(animator: R<AnimatorT>, id: number): readonly SupportIssue[] {
  const rules = new SupportChecks();
  rules.require(
    [0, 1, 2].includes(animator.updateMode),
    'CAPABILITY',
    `animators.${id}.updateMode`,
    animator.updateMode,
    'Unknown Animator clock',
  );
  rules.require(
    [0, 1, 2].includes(animator.cullingMode),
    'CAPABILITY',
    `animators.${id}.cullingMode`,
    animator.cullingMode,
    'Unknown Animator culling mode',
  );
  return rules.issues;
}

/** Disabled renderers acquire resources only when an animation can enable them. */
export function rendererCanPlay(pack: EffectPack, id: number, enabled: boolean): boolean {
  return (
    enabled ||
    pack.document.animations.some((a) =>
      a.tracks.some(
        (t) =>
          t.binding!.targetId === id &&
          [AnimationProperty.ComponentEnabled, AnimationProperty.RendererEnabled].includes(
            t.binding!.property,
          ),
      ),
    )
  );
}
