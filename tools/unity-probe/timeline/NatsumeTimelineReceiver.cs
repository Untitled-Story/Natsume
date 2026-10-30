using System;
using UnityEngine;
using UnityEngine.Timeline;

/** Native ITimeControl counters; probe state is not serialized into the package. */
public sealed class NatsumeTimelineReceiver : MonoBehaviour, ITimeControl
{
    [NonSerialized] public int starts,stops,samples;
    [NonSerialized] public double time;
    [NonSerialized] public int events;
    [NonSerialized] public float eventX;
    public void ReceiveTimelineEvent(AnimationEvent value) {events++;var target=transform.Find("target");eventX=target?target.localPosition.x:0;}
    public void OnControlTimeStart() { starts++; }
    public void OnControlTimeStop() { stops++; }
    public void SetTime(double seconds) { time=seconds;samples++; }
}
