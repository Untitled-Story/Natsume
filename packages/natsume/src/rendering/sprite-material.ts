import type { DeepReadonly as R } from '../pack.js';
import type { SpriteAssetT } from '../format/generated/noa/ir/sprite-asset.js';
import { MaterialT } from '../format/generated/noa/ir/material.js';
import { TextureBindingT } from '../format/generated/noa/ir/texture-binding.js';
import type { SamplerT } from '../format/generated/noa/ir/sampler.js';
/** Replaces the renderer-owned image while retaining live animated material values. */
export function spriteMaterial(original: R<MaterialT>, sprite: R<SpriteAssetT>): MaterialT {
  const material = Object.assign(new MaterialT(), original),
    binding = Object.assign(new TextureBindingT(), original.textures[0]);
  binding.imageId = sprite.imageAssetId;
  binding.sampler = sprite.sampler as SamplerT;
  binding.colorSpace = sprite.colorSpace;
  material.textures = [binding];
  return material;
}
