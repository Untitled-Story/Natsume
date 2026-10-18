import { appendFileSync } from 'node:fs';

/** Records native or analytic comparison errors when a measurement output path is set. */
export function recordError(
  metric: string,
  error: number,
  unit: string,
  sample: string,
  reference: 'unity' | 'analytic' = 'unity',
): void {
  const path = process.env.NATSUME_MEASUREMENTS;
  if (!path) return;
  if (!Number.isFinite(error)) throw new Error(`Nonfinite measurement: ${metric} / ${sample}`);
  appendFileSync(
    path,
    JSON.stringify({ metric, error: Math.abs(error), unit, sample, reference }) + '\n',
  );
}
