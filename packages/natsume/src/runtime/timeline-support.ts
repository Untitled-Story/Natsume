import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { PlayableDirectorT } from '../format/generated/noa/ir/playable-director.js';
import type { TypedReferenceT } from '../format/generated/noa/ir/typed-reference.js';
import type { TimelineControlT } from '../format/generated/noa/ir/timeline-control.js';
import { SupportChecks, type SupportIssue } from './support-checks.js';

/** Checks references against the selected entry rather than the entire source document. */
export function directorSupport(
  pack: EffectPack,
  director: R<PlayableDirectorT>,
  nodes: ReadonlySet<number>,
): readonly SupportIssue[] {
  const rules = new SupportChecks();
  const target = (reference: R<TypedReferenceT> | null, path: string) => {
    if (!reference) return;
    const id = reference.kind === 2 ? pack.getComponent(reference.id)?.nodeId : reference.id;
    rules.require(
      (reference.kind === 1 || reference.kind === 2) && id !== undefined && nodes.has(id),
      'CAPABILITY',
      path,
      reference.id,
      'Director reference must resolve inside the selected entry',
    );
  };
  for (const [i, b] of director.bindings.entries()) target(b.target, `bindings.${i}.target`);
  for (const [i, b] of director.exposedReferences.entries())
    target(b.target, `exposedReferences.${i}.target`);
  for (const [i, track] of (director.timeline?.tracks ?? []).entries()) {
    target(track.target, `timeline.tracks.${i}.target`);
    for (const [j, clip] of track.clips.entries())
      if (clip.dataType === 2)
        target(
          (clip.data as R<TimelineControlT>).defaultTarget,
          `timeline.tracks.${i}.clips.${j}.defaultTarget`,
        );
  }
  return rules.issues;
}
