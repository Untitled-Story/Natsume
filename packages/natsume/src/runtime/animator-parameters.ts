import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { AnimatorParameterT } from '../format/generated/noa/ir/animator-parameter.js';
import { AnimatorParameterType as T } from '../format/generated/noa/ir/animator-parameter-type.js';

/** Typed, instance-owned controller parameters. Triggers remain set until consumed. */
export class AnimatorParameters {
  private readonly definitions = new Map<string, R<AnimatorParameterT>>();
  private readonly values = new Map<string, number | boolean>();
  constructor(parameters: readonly R<AnimatorParameterT>[]) {
    for (const parameter of parameters) this.definitions.set(String(parameter.name), parameter);
    this.reset();
  }
  reset(): void {
    for (const [name, p] of this.definitions)
      this.values.set(
        name,
        p.type === T.Float
          ? Math.fround(p.defaultFloat)
          : p.type === T.Int
            ? p.defaultInt
            : p.defaultBool,
      );
  }
  private require(name: string, type: T): void {
    check(
      typeof name === 'string' && this.definitions.get(name)?.type === type,
      'HOST',
      'Unknown Animator parameter or incompatible parameter type: ' + name,
    );
  }
  getFloat(name: string): number {
    this.require(name, T.Float);
    return this.values.get(name) as number;
  }
  setFloat(name: string, value: number): void {
    this.require(name, T.Float);
    check(
      Number.isFinite(value) && Number.isFinite(Math.fround(value)),
      'HOST',
      'Animator Float must be finite Float32',
    );
    this.values.set(name, Math.fround(value));
  }
  getInt(name: string): number {
    this.require(name, T.Int);
    return this.values.get(name) as number;
  }
  setInt(name: string, value: number): void {
    this.require(name, T.Int);
    check(
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
      'HOST',
      'Animator Int must be int32',
    );
    this.values.set(name, value);
  }
  getBool(name: string): boolean {
    this.require(name, T.Bool);
    return this.values.get(name) as boolean;
  }
  setBool(name: string, value: boolean): void {
    this.require(name, T.Bool);
    check(typeof value === 'boolean', 'HOST', 'Animator Bool must be boolean');
    this.values.set(name, value);
  }
  setTrigger(name: string): void {
    this.require(name, T.Trigger);
    this.values.set(name, true);
  }
  resetTrigger(name: string): void {
    this.require(name, T.Trigger);
    this.values.set(name, false);
  }
  value(name: string): number | boolean {
    return this.values.get(name)!;
  }
  isTrigger(name: string): boolean {
    return this.definitions.get(name)?.type === T.Trigger;
  }
}
