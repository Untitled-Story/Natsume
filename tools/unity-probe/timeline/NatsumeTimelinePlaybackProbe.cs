#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Playables;
using UnityEngine.Timeline;

/** Captures actual PlayerLoop Director clocks, wrapping and activation. */
public sealed class NatsumeTimelinePlaybackProbe : MonoBehaviour
{
    [Serializable] public class Sample { public int frame,events; public double time; public bool active; public string state; public float x,eventX; }
    [Serializable] public class Case { public int clock,wrap; public List<Sample> samples=new List<Sample>(); [NonSerialized] public PlayableDirector director; [NonSerialized] public GameObject target; [NonSerialized] public NatsumeTimelineReceiver receiver; }
    [Serializable] public class Clock { public float scaled,unscaled; public double dsp; }
    [Serializable] public class Output { public string unityVersion; public int dspBufferLength,sampleRate; public List<Case> cases=new List<Case>(); public List<Clock> clocks=new List<Clock>(); }
    Output output=new Output();int frame;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("timeline-playback").AddComponent<NatsumeTimelinePlaybackProbe>();EditorApplication.EnterPlaymode();
    }
    void Start() {
        output.unityVersion=Application.unityVersion;Time.captureFramerate=60;
        int buffers;AudioSettings.GetDSPBufferSize(out output.dspBufferLength,out buffers);output.sampleRate=AudioSettings.outputSampleRate;
        for(int clock=0;clock<4;clock++)for(int wrap=0;wrap<3;wrap++) {
            var root=new GameObject("director");var target=new GameObject("target");target.transform.SetParent(root.transform,false);
            var director=root.AddComponent<PlayableDirector>();director.playOnAwake=false;director.timeUpdateMode=(DirectorUpdateMode)clock;director.extrapolationMode=(DirectorWrapMode)wrap;director.initialTime=.2;
            var timeline=ScriptableObject.CreateInstance<TimelineAsset>();timeline.durationMode=TimelineAsset.DurationMode.FixedLength;timeline.fixedDuration=.75;
            var track=timeline.CreateTrack<ActivationTrack>(null,"activation");track.postPlaybackState=ActivationTrack.PostPlaybackState.Revert;var clip=track.CreateDefaultClip();clip.start=.25;clip.duration=.5;
            var animator=root.AddComponent<Animator>();animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;var receiver=root.AddComponent<NatsumeTimelineReceiver>();
            var motion=new AnimationClip();motion.SetCurve("target",typeof(Transform),"localPosition.x",AnimationCurve.Linear(0,0,.75f,3));
            var events=new List<AnimationEvent>();foreach(float at in new[]{0f,.1f,.3f,.6f,.75f})events.Add(new AnimationEvent{time=at,functionName="ReceiveTimelineEvent"});AnimationUtility.SetAnimationEvents(motion,events.ToArray());
            var animation=timeline.CreateTrack<AnimationTrack>(null,"animation");animation.trackOffset=TrackOffset.ApplyTransformOffsets;var animationClip=animation.CreateClip(motion);animationClip.start=0;animationClip.duration=.75;
            director.playableAsset=timeline;director.SetGenericBinding(track,target);director.SetGenericBinding(animation,animator);director.Play();output.cases.Add(new Case{clock=clock,wrap=wrap,director=director,target=target,receiver=receiver});
        }
    }
    void Update() {if(frame==10)Time.timeScale=.5f;if(frame==25)Time.timeScale=0;if(frame==35)Time.timeScale=1;}
    void LateUpdate() {
        output.clocks.Add(new Clock{scaled=Time.deltaTime,unscaled=Time.unscaledDeltaTime,dsp=AudioSettings.dspTime});
        foreach(var row in output.cases)row.samples.Add(new Sample{frame=frame,time=row.director.time,active=row.target.activeSelf,state=row.director.state.ToString(),events=row.receiver.events,x=row.target.transform.localPosition.x,eventX=row.receiver.eventX});
        if(++frame<90)return;
        Time.timeScale=1;File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(output,true));EditorApplication.Exit(0);
    }
}
#endif
