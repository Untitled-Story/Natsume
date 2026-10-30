import type {
  AnimatorController,
  AnimatorStateInfo,
  AnimatorTransitionInfo,
} from './animator-controller.js';

/** Instance-owned flat Animator controller. Names and parameter types are checked. */
export class NatsumeAnimator {
  constructor(
    private readonly controller: AnimatorController,
    private readonly assertAlive: () => void,
  ) {}
  /** Number of source layers, including empty layers. */
  get layerCount(): number {
    this.assertAlive();
    return this.controller.layerCount;
  }
  getFloat(name: string): number {
    this.assertAlive();
    return this.controller.parameters.getFloat(name);
  }
  setFloat(name: string, value: number): void {
    this.assertAlive();
    this.controller.parameters.setFloat(name, value);
  }
  getInt(name: string): number {
    this.assertAlive();
    return this.controller.parameters.getInt(name);
  }
  setInt(name: string, value: number): void {
    this.assertAlive();
    this.controller.parameters.setInt(name, value);
  }
  getBool(name: string): boolean {
    this.assertAlive();
    return this.controller.parameters.getBool(name);
  }
  setBool(name: string, value: boolean): void {
    this.assertAlive();
    this.controller.parameters.setBool(name, value);
  }
  /** Remains set until a selected transition consumes it or resetTrigger is called. */
  setTrigger(name: string): void {
    this.assertAlive();
    this.controller.parameters.setTrigger(name);
  }
  resetTrigger(name: string): void {
    this.assertAlive();
    this.controller.parameters.resetTrigger(name);
  }
  /** Base layer is always effective at weight 1. */
  getLayerWeight(layer: number): number {
    this.assertAlive();
    return this.controller.getLayerWeight(layer);
  }
  /** Sets an upper layer's blend weight in [0, 1], applied on the next evaluation. */
  setLayerWeight(layer: number, weight: number): void {
    this.assertAlive();
    this.controller.setLayerWeight(layer, weight);
  }
  /** Empty layers return undefined. Snapshots do not change after evaluation. */
  getCurrentState(layer = 0): AnimatorStateInfo | undefined {
    this.assertAlive();
    return this.controller.getCurrentState(layer);
  }
  getNextState(layer = 0): AnimatorStateInfo | undefined {
    this.assertAlive();
    return this.controller.getNextState(layer);
  }
  getTransition(layer = 0): AnimatorTransitionInfo | undefined {
    this.assertAlive();
    return this.controller.getTransition(layer);
  }
  /** Supplies renderer visibility for source culling modes; defaults to true. */
  setVisible(visible: boolean): void {
    this.assertAlive();
    this.controller.setVisible(visible);
  }
}
