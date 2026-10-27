/** Float32 reciprocal estimate with two Newton steps, matching Unity's ARM particle births. */
export function reciprocalLifetime(lifetime: number): number {
  const exponent = Math.floor(Math.log2(lifetime));
  const normalized = lifetime / 2 ** (exponent + 1);
  const bucket = Math.floor(normalized * 512);
  let inverse = (Math.round((512 / (bucket + 0.5)) * 256) / 256) * 2 ** (-exponent - 1);
  inverse = Math.fround(inverse * Math.fround(2 - lifetime * inverse));
  return Math.fround(inverse * Math.fround(2 - lifetime * inverse));
}

/** Native particle age advances as a Float32 percentage of the start lifetime. */
export function advanceLifetimeProgress(
  progress: number,
  seconds: number,
  inverseLifetime: number,
): number {
  return Math.fround(progress + Math.fround(Math.fround(seconds * 100) * inverseLifetime));
}

/** Converts percentage age through the native remaining-lifetime representation. */
export function lifetimeProgressAge(progress: number, lifetime: number): number {
  return Math.fround(
    lifetime - Math.fround(Math.fround(1 - Math.fround(progress * Math.fround(0.01))) * lifetime),
  );
}
