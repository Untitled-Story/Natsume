/** Source StopAction.Callback notification, sent after the system and its descendants drain. */
export interface ParticleSystemStoppedEvent {
  readonly systemId: number;
  readonly nodeId: number;
}
