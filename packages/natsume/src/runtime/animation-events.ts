import type { DeepReadonly as R } from '../pack.js';
import type { AnimationEventT } from '../format/generated/noa/ir/animation-event.js';
import type { ReferenceValueT } from '../format/generated/noa/ir/reference-value.js';

/** Source message; object references retain their GUID and bigint fileID. */
export interface NatsumeAnimationEvent {
  readonly clipId: number;
  readonly animatorId: number;
  readonly nodeId: number | undefined;
  readonly timeSeconds: number;
  readonly name: string;
  readonly stringParameter: string;
  readonly floatParameter: number;
  readonly intParameter: number;
  readonly objectParameter: R<ReferenceValueT> | null;
  readonly requireReceiver: boolean;
}

/** Return true to acknowledge the message. */
export type AnimationEventHandler = (event: NatsumeAnimationEvent) => boolean | void;

/** Visits source-ordered occurrences in (from,to], including duration before the next zero. */
export function visitAnimationEvents(
  events: readonly R<AnimationEventT>[],
  duration: number,
  loop: boolean,
  from: number,
  to: number,
  visit: (event: R<AnimationEventT>) => boolean,
): void {
  if (to < from || events.length === 0) return;
  if (duration === 0) {
    if (from < 0 && to >= 0) for (const event of events) if (!visit(event)) return;
    return;
  }
  const first = loop ? Math.max(0, Math.floor(from)) : 0;
  const last = loop ? Math.floor(to) : 0;
  for (let cycle = first; cycle <= last; cycle++)
    for (const event of events) {
      const at = Math.fround(cycle + Math.fround(event.timeSeconds / duration));
      if (at > from && at <= to && !visit(event)) return;
    }
}
