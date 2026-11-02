import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ShapeTextureT } from '../format/generated/noa/ir/shape-texture.js';

/** CPU birth sampler for Unity Shape Texture; coordinates are bottom-left UVs. */
export class ShapeTextureSampler {
  private readonly image;
  constructor(
    pack: EffectPack,
    private readonly definition: R<ShapeTextureT>,
  ) {
    this.image = pack.getImagePixels(definition.imageAssetId);
  }
  sample(out: Float64Array): boolean {
    const { width, height, rgba } = this.image;
    const d = this.definition;
    const wrap = (v: number) => (v >= 0 && v <= 1 ? v : v - Math.floor(v));
    const u = wrap(out[10]!),
      v = wrap(out[11]!);
    const x = d.bilinearFiltering
      ? Math.max(0, Math.min(width * 256 - 1, Math.floor((u * width - 0.5) * 255))) / 256
      : Math.max(0, Math.min(width - 1, u * width - 0.5));
    const y = d.bilinearFiltering
      ? Math.max(0, Math.min(height * 256 - 1, Math.floor((v * height - 0.5) * 255))) / 256
      : Math.max(0, Math.min(height - 1, v * height - 0.5));
    const ix = d.bilinearFiltering ? Math.floor(x) : Math.ceil(x - 0.5);
    const iy = d.bilinearFiltering ? Math.floor(y) : Math.ceil(y - 0.5);
    const read = (px: number, py: number, channel: number) => {
      const cx = Math.max(0, Math.min(width - 1, px));
      const cy = Math.max(0, Math.min(height - 1, py));
      return rgba[((height - 1 - cy) * width + cx) * 4 + channel]!;
    };
    let accepted = true;
    for (let channel = 0; channel < 4; channel++) {
      let value = read(ix, iy, channel);
      if (d.bilinearFiltering) {
        const lerp = (a: number, b: number, t: number) => Math.floor(a * (1 - t) + b * t);
        const fx = x - ix;
        const fy = y - iy;
        value = lerp(
          lerp(read(ix, iy, channel), read(ix + 1, iy, channel), fx),
          lerp(read(ix, iy + 1, channel), read(ix + 1, iy + 1, channel), fx),
          fy,
        );
      }
      if (channel === d.clipChannel && value < d.clipThreshold * 256) accepted = false;
      if (channel === 3 && d.alphaAffectsParticles && value === 0) accepted = false;
      if (channel < 3 ? d.colorAffectsParticles : d.alphaAffectsParticles)
        out[6 + channel] = (out[6 + channel]! * value) / 255;
    }
    return accepted;
  }
}
