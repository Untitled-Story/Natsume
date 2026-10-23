import type { DeepReadonly as R } from '../pack.js';
import type { SpriteAssetT } from '../format/generated/noa/ir/sprite-asset.js';
/** Shares atlas pixels across frames while retaining distinct source sampling states. */
export function spriteTextureKey(sprite: R<SpriteAssetT>): string {
  const s = sprite.sampler;
  return [
    'sprite',
    sprite.imageAssetId,
    s?.minFilter ?? 1,
    s?.magFilter ?? 1,
    s?.wrapU ?? 0,
    s?.wrapV ?? 0,
  ].join(':');
}
