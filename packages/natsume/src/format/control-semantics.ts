import { check } from '../errors.js';
import type { DocumentT } from './generated/noa/ir/document.js';
import type { AnimatorT } from './generated/noa/ir/animator.js';
import type { AnimatorTransitionT } from './generated/noa/ir/animator-transition.js';
import type { ParticleSystemT } from './generated/noa/ir/particle-system.js';
import type { ParticleRendererT } from './generated/noa/ir/particle-renderer.js';
import type { SubEmittersModuleT } from './generated/noa/ir/sub-emitters-module.js';
import type { TrailsModuleT } from './generated/noa/ir/trails-module.js';
import type { PlayableDirectorT } from './generated/noa/ir/playable-director.js';
import type { TimelineT } from './generated/noa/ir/timeline.js';
import type { TimelineAnimationT } from './generated/noa/ir/timeline-animation.js';
import type { TimelineControlT } from './generated/noa/ir/timeline-control.js';
import type { TypedReferenceT } from './generated/noa/ir/typed-reference.js';
import { ComponentData as C } from './generated/noa/ir/component-data.js';
import { ParticleModuleData as M } from './generated/noa/ir/particle-module-data.js';
import { VertexSemantic as V } from './generated/noa/ir/vertex-semantic.js';

/** Cross-component references and local controller/Timeline namespaces. */
export function validateControl(d: DocumentT, required: (name: string) => void): void {
  const components = new Map(d.components.map((c) => [c.id, c]));
  const systems = new Map(
    d.components
      .filter((c) => c.dataType === C.ParticleSystem)
      .map((c) => [c.id, c.data as ParticleSystemT]),
  );
  const edges = new Map<number, number[]>(),
    indegree = new Map([...systems.keys()].map((id) => [id, 0]));
  for (const [id, system] of systems)
    for (const module of system.modules) {
      const path = `components.${id}.modules.${module.dataType}`;
      if (module.dataType === M.SubEmittersModule) {
        required('particle.sub-emitters');
        for (const [index, e] of (module.data as SubEmittersModuleT).emitters.entries()) {
          check(
            (e.inheritProperties & ~31) === 0 && e.probability >= 0 && e.probability <= 1,
            'SEMANTIC',
            'Invalid sub emitter slot',
            `${path}.emitters.${index}`,
          );
          if (e.systemComponentId) {
            check(
              systems.has(e.systemComponentId),
              'SEMANTIC',
              'Sub emitter must target ParticleSystem',
              path,
            );
            indegree.set(e.systemComponentId, indegree.get(e.systemComponentId)! + 1);
            const targets = edges.get(id) ?? [];
            targets.push(e.systemComponentId);
            edges.set(id, targets);
          }
        }
      }
      if (module.dataType === M.TrailsModule) {
        required('particle.trails');
        const t = module.data as TrailsModuleT;
        check(
          t.ratio >= 0 && t.ratio <= 1 && t.minVertexDistance >= 0 && t.ribbonCount > 0,
          'SEMANTIC',
          'Invalid trail ratio, distance or ribbon count',
          path,
        );
        check(
          t.lifetime &&
            t.widthOverTrail &&
            t.colorOverLifetime &&
            t.colorOverTrail &&
            t.textureScale,
          'SEMANTIC',
          'Missing trail parameters',
          path,
        );
      }
    }
  const ready = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < ready.length; i++)
    for (const next of edges.get(ready[i]!) ?? []) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) ready.push(next);
    }
  check(ready.length === systems.size, 'SEMANTIC', 'Cyclic sub emitter graph');
  const target = (t: TypedReferenceT | null, path: string) => {
    if (!t) return;
    check(
      (t.kind === 1 && d.nodes.some((n) => n.id === t.id)) ||
        (t.kind === 2 && components.has(t.id)),
      'SEMANTIC',
      'Director binding must target an instantiated node/component',
      path,
    );
  };
  for (const c of d.components) {
    const path = `components.${c.id}`;
    if (c.dataType === C.ParticleRenderer) {
      const r = c.data as ParticleRendererT;
      check(
        !!r.trailVertexStreams ===
          !!systems.get(r.systemComponentId)?.modules.some((m) => m.dataType === M.TrailsModule),
        'SEMANTIC',
        'Trail streams presence must match active Trails module',
        path,
      );
      for (const [index, s] of [...r.vertexStreams, ...(r.trailVertexStreams ?? [])].entries()) {
        const valid = [
          V.Position,
          V.Normal,
          V.Velocity,
          V.Center,
          V.NextTrailCenter,
          V.PreviousTrailCenter,
        ].includes(s.semantic)
          ? s.components === 3
          : [V.Color, V.Tangent].includes(s.semantic)
            ? s.components === 4
            : [V.UV0, V.UV1, V.UV2, V.UV3].includes(s.semantic)
              ? s.components === 2
              : s.semantic === V.Size
                ? s.components >= 1 && s.components <= 3
                : s.semantic === V.Rotation
                  ? s.components === 1 || s.components === 3
                  : [V.Custom1, V.Custom2].includes(s.semantic)
                    ? s.components >= 1 && s.components <= 4
                    : [V.AgeNormalized, V.VertexId, V.PercentageAlongTrail, V.TrailWidth].includes(
                        s.semantic,
                      ) && s.components === 1;
        check(
          valid,
          'SEMANTIC',
          'Invalid vertex stream semantics/components',
          `${path}.streams.${index}`,
        );
      }
    }
    if (c.dataType === C.Animator) {
      required('animator.controller');
      validateAnimator(c.data as AnimatorT, path, d);
    }
    if (c.dataType === C.PlayableDirector) {
      required('timeline.director');
      const p = c.data as PlayableDirectorT;
      check(
        p.initialTime >= 0 &&
          !!p.sourceAsset === !!p.timeline &&
          (!p.sourceAsset || p.sourceAsset.fileId !== 0n),
        'SEMANTIC',
        'Invalid Director time/source asset',
        path,
      );
      const keys = new Set<string>(),
        names = new Set<string>();
      for (const b of p.bindings) {
        const key = `${b.key!.guid}:${b.key!.fileId}`;
        check(!keys.has(key), 'SEMANTIC', 'Duplicate Director binding', path);
        keys.add(key);
        target(b.target, path);
      }
      for (const b of p.exposedReferences) {
        check(
          b.name && !names.has(String(b.name)),
          'SEMANTIC',
          'Invalid exposed binding name',
          path,
        );
        names.add(String(b.name));
        target(b.target, path);
      }
      if (p.timeline) {
        required('timeline.graph');
        validateTimeline(p.timeline, path, d, target);
      }
    }
  }
}

function validateAnimator(a: AnimatorT, path: string, d: DocumentT): void {
  check(
    a.sourceController
      ? a.sourceController.fileId !== 0n
      : !a.layers.length && !a.parameters.length,
    'SEMANTIC',
    'Animator Controller/source presence mismatch',
    path,
  );
  const params = new Map<string, number>();
  for (const p of a.parameters) {
    check(
      p.name && !params.has(String(p.name)),
      'SEMANTIC',
      'Invalid/duplicate Animator parameter',
      path,
    );
    params.set(String(p.name), p.type);
  }
  const layers = new Set<string>();
  for (const [index, l] of a.layers.entries()) {
    const lp = `${path}.layers.${index}`;
    check(
      l.name && !layers.has(String(l.name)) && l.defaultWeight >= 0 && l.defaultWeight <= 1,
      'SEMANTIC',
      'Invalid Animator layer',
      lp,
    );
    layers.add(String(l.name));
    const states = new Set(l.states.map((s) => s.id)),
      names = new Set<string>();
    check(
      states.size === l.states.length &&
        !states.has(0) &&
        (l.states.length ? states.has(l.defaultStateId) : l.defaultStateId === 0),
      'SEMANTIC',
      'Invalid Animator state IDs/default state',
      lp,
    );
    const transition = (t: AnimatorTransitionT, entry = false, any = false) => {
      check(
        t.isExit ? !entry && !any && t.destinationStateId === 0 : states.has(t.destinationStateId),
        'SEMANTIC',
        'Invalid Animator transition destination',
        lp,
      );
      check(
        t.duration >= 0 && t.exitTime >= 0,
        'SEMANTIC',
        'Invalid Animator transition timing',
        lp,
      );
      for (const c of t.conditions) {
        const ty = params.get(String(c.parameter));
        const valid =
          ty === 2 || ty === 3
            ? c.mode === 0 || c.mode === 1
            : ty === 0
              ? c.mode === 2 || c.mode === 3
              : ty === 1 &&
                c.mode >= 2 &&
                c.mode <= 5 &&
                Number.isInteger(c.threshold) &&
                c.threshold >= -2147483648 &&
                c.threshold <= 2147483647;
        check(valid, 'SEMANTIC', 'Condition does not match parameter type', lp);
      }
    };
    for (const s of l.states) {
      check(s.name && !names.has(String(s.name)), 'SEMANTIC', 'Invalid Animator state name', lp);
      names.add(String(s.name));
      check(
        !s.animationId || d.animations.some((a) => a.id === s.animationId),
        'SEMANTIC',
        'Invalid Animator animation reference',
        lp,
      );
      for (const p of [s.speedParameter, s.cycleOffsetParameter, s.timeParameter])
        if (p !== null)
          check(params.get(String(p)) === 0, 'SEMANTIC', 'State control needs float parameter', lp);
      for (const t of s.transitions) transition(t);
    }
    for (const t of l.anyStateTransitions) transition(t, false, true);
    for (const t of l.entryTransitions) transition(t, true);
  }
}

function validateTimeline(
  t: TimelineT,
  path: string,
  d: DocumentT,
  target: (t: TypedReferenceT | null, path: string) => void,
): void {
  check(t.fixedDuration >= 0, 'SEMANTIC', 'Invalid Timeline duration', path);
  const visited = new Set<number>(),
    pending: [number, number][] = t.roots.map((i) => [i, -1]);
  while (pending.length) {
    const [index, parent] = pending.pop()!,
      track = t.tracks[index];
    check(
      track && !visited.has(index) && track.parentIndex === parent && track.source?.fileId !== 0n,
      'SEMANTIC',
      'Invalid Timeline hierarchy/source',
      `${path}.tracks.${index}`,
    );
    visited.add(index);
    target(track.target, path);
    check(track.kind !== 0 || !track.clips.length, 'SEMANTIC', 'GroupTrack cannot own clips', path);
    check(
      track.kind !== 1 || !track.target || track.target.kind === 1,
      'SEMANTIC',
      'ActivationTrack needs node binding',
      path,
    );
    if (track.kind === 2)
      check(
        track.target?.kind === 2 &&
          d.components.some((c) => c.id === track.target!.id && c.dataType === C.Animator) &&
          track.position &&
          track.eulerRadians &&
          track.trackOffset <= 2 &&
          (track.matchTargetFields & ~63) === 0,
        'SEMANTIC',
        'Invalid AnimationTrack binding/offset',
        path,
      );
    for (const c of track.clips) {
      check(
        c.start >= 0 &&
          c.duration > 0 &&
          c.clipIn >= 0 &&
          c.timeScale > 0 &&
          c.easeIn >= 0 &&
          c.easeOut >= 0 &&
          c.blendIn >= -1 &&
          c.blendOut >= -1 &&
          c.preExtrapolationTime >= 0 &&
          c.postExtrapolationTime >= 0,
        'SEMANTIC',
        'Invalid Timeline clip timing',
        path,
      );
      for (const curve of [c.mixIn, c.mixOut])
        check(curve?.domain === 1, 'SEMANTIC', 'Timeline mix curve must be normalized', path);
      if (track.kind === 1)
        check(c.dataType === 0, 'SEMANTIC', 'Activation clip payload mismatch', path);
      else if (track.kind === 2) {
        const a = c.data as TimelineAnimationT;
        check(
          c.dataType === 1 &&
            a &&
            d.animations.some((v) => v.id === a.animationId) &&
            a.position &&
            a.eulerRadians &&
            (a.matchTargetFields & ~63) === 0,
          'SEMANTIC',
          'Invalid Timeline animation',
          path,
        );
      } else if (track.kind === 3) {
        const control = c.data as TimelineControlT;
        check(
          c.dataType === 2 &&
            control &&
            (!control.defaultTarget || control.defaultTarget.kind === 1) &&
            control.postPlayback <= 2,
          'SEMANTIC',
          'Invalid Timeline control',
          path,
        );
        target(control.defaultTarget, path);
      }
    }
    for (const child of track.children) pending.push([child, index]);
  }
  check(visited.size === t.tracks.length, 'SEMANTIC', 'Unreachable Timeline tracks', path);
}
