using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Playables;
using UnityEngine.Timeline;

/** Records real Timeline graph evaluation, activation and animation boundaries. */
public static class NatsumeTimelineProbe
{
    [Serializable] public class SystemSample { public string name; public int count; public float time; public uint seed; }
    [Serializable] public class Sample { public List<SystemSample> systems=new List<SystemSample>(); public double time,directorTime,controlTime,nestedTime; public bool active; public Vector3 position; public string state; public int starts,stops,controlSamples,particles; public float particleTime; }
    [Serializable] public class Case { public string label,prefab; public double duration; public List<Sample> samples=new List<Sample>(); public bool stoppedActive,settledActive; public Vector3 stoppedPosition; }
    [Serializable] public class Output { public string unityVersion; public List<Case> cases=new List<Case>(); }
    [Serializable] public class ScriptIdentity { public string guid,file_id,assembly,@namespace,class_name; }
    [Serializable] public class Metadata { public string format="unity-monoscript-metadata"; public int version=1; public List<ScriptIdentity> scripts=new List<ScriptIdentity>(); }
    const string Folder="Assets/TimelineProbe";
    public static void Run()
    {
        UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,UnityEditor.SceneManagement.NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;
        EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        EditorApplication.playModeStateChanged+=state=>{
            if(state!=PlayModeStateChange.EnteredPlayMode)return;
            try { Measure(); } catch(Exception e) { Debug.LogException(e);EditorApplication.Exit(1); }
        };
        EditorApplication.EnterPlaymode();
    }
    static void Measure()
    {
        Directory.CreateDirectory(Folder);
        var output=new Output { unityVersion=Application.unityVersion };
        var retained=new List<GameObject>();
        for(int kind=0;kind<19;kind++)for(int post=0;post<(kind==0?4:1);post++)for(int wrap=0;wrap<3;wrap++)
        {
            string label="kind-"+kind+"-post-"+post+"-wrap-"+wrap;
            string stem=Folder+"/"+label;
            var root=new GameObject(label); var target=new GameObject("target");target.transform.SetParent(root.transform,false);target.transform.localPosition=new Vector3(7,11,13);
            var director=root.AddComponent<PlayableDirector>();director.playOnAwake=false;director.timeUpdateMode=DirectorUpdateMode.Manual;director.extrapolationMode=(DirectorWrapMode)wrap;
            var timeline=ScriptableObject.CreateInstance<TimelineAsset>();AssetDatabase.CreateAsset(timeline,stem+".playable");director.playableAsset=timeline;
            NatsumeTimelineReceiver receiver=null;ParticleSystem particles=null;PlayableDirector nested=null;
            if((kind>=5 && kind<=8)||kind>=15) {
                var group=timeline.CreateTrack<GroupTrack>(null,"group");group.muted=kind==8;
                var track=timeline.CreateTrack<ControlTrack>(group,"control");var c=track.CreateDefaultClip();c.start=.25;c.duration=.5;
                var control=(ControlPlayableAsset)c.asset;control.sourceGameObject.exposedName="subject";director.SetReferenceValue("subject",target);control.active=kind==5||kind==8;control.updateParticle=kind==7||kind>=15;control.updateDirector=kind==6;control.updateITimeControl=kind==5;control.searchHierarchy=true;control.particleRandomSeed=42;
                if(kind==5)receiver=target.AddComponent<NatsumeTimelineReceiver>();
                if(kind==6) {
                    nested=target.AddComponent<PlayableDirector>();nested.playOnAwake=false;nested.timeUpdateMode=DirectorUpdateMode.Manual;
                    var sub=ScriptableObject.CreateInstance<TimelineAsset>();AssetDatabase.CreateAsset(sub,stem+"-nested.playable");sub.durationMode=TimelineAsset.DurationMode.FixedLength;sub.fixedDuration=1;
                    var active=sub.CreateTrack<ActivationTrack>(null,"nested-activation");var child=new GameObject("nested-target");child.transform.SetParent(target.transform,false);nested.SetGenericBinding(active,child);var subclip=active.CreateDefaultClip();subclip.start=.1;subclip.duration=.3;nested.playableAsset=sub;
                }
                if(kind==7||kind>=15) {
                    particles=target.AddComponent<ParticleSystem>();particles.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=particles.main;main.duration=1;main.loop=true;main.playOnAwake=false;main.startLifetime=1;main.startSpeed=0;main.startSize=1;main.maxParticles=100;main.useUnscaledTime=false;
                    var emission=particles.emission;emission.rateOverTime=12;particles.GetComponent<ParticleSystemRenderer>().enabled=false;
                    if(kind==15){var child=new GameObject("child-particles");child.transform.SetParent(target.transform,false);var ps=child.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var cm=ps.main;cm.duration=1;cm.loop=true;cm.playOnAwake=false;cm.startLifetime=1;cm.startSpeed=0;cm.maxParticles=100;var ce=ps.emission;ce.rateOverTime=12;ps.GetComponent<ParticleSystemRenderer>().enabled=false;}
                    if(kind==16){main.prewarm=true;}
                    if(kind==18){main.startDelay=.1f;}
                    if(kind==17){var second=track.CreateDefaultClip();second.start=.5;second.duration=.5;var sc=(ControlPlayableAsset)second.asset;sc.sourceGameObject.exposedName="subject";sc.active=false;sc.updateParticle=true;sc.updateDirector=false;sc.updateITimeControl=false;sc.searchHierarchy=true;sc.particleRandomSeed=73;}

                }
            }
            else if(kind==0){var track=timeline.CreateTrack<ActivationTrack>(null,"activation");track.postPlaybackState=(ActivationTrack.PostPlaybackState)post;director.SetGenericBinding(track,target);var c=track.CreateDefaultClip();c.start=.25;c.duration=.5;}
            else {
                var animator=root.AddComponent<Animator>();animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;
                if(kind==14) {
                    var baseline=new AnimationClip {name="controller-base"};baseline.SetCurve("target",typeof(Transform),"localPosition.x",AnimationCurve.Constant(0,1,20));AssetDatabase.CreateAsset(baseline,stem+"-base.anim");
                    var controller=UnityEditor.Animations.AnimatorController.CreateAnimatorControllerAtPath(stem+".controller");var state=controller.layers[0].stateMachine.AddState("base");state.motion=baseline;animator.runtimeAnimatorController=controller;animator.Rebind();animator.Update(0);
                }
                var track=timeline.CreateTrack<AnimationTrack>(null,"animation");track.trackOffset=TrackOffset.ApplyTransformOffsets;director.SetGenericBinding(track,animator);
                for(int j=0;j<(kind==2?2:1);j++) {
                    var animation=new AnimationClip {name="motion"+j,legacy=false};animation.SetCurve("target",typeof(Transform),"localPosition.x",AnimationCurve.Linear(0,j==0?1:10,1,j==0?5:14));
                    var settings=AnimationUtility.GetAnimationClipSettings(animation);settings.loopTime=kind==3;AnimationUtility.SetAnimationClipSettings(animation,settings);AssetDatabase.CreateAsset(animation,stem+"-"+j+".anim");
                    var c=track.CreateClip(animation);c.start=j==0?.25:.5;c.duration=kind==3?2:.75;c.clipIn=kind==4?.2:0;c.timeScale=kind==4?2:1;
                    if(kind==1||kind==14){c.easeInDuration=.2;c.easeOutDuration=.2;}
                    if(kind>=9 && kind<=12){typeof(TimelineClip).GetField("m_PreExtrapolationMode",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).SetValue(c,(TimelineClip.ClipExtrapolation)(kind-8));typeof(TimelineClip).GetField("m_PostExtrapolationMode",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).SetValue(c,(TimelineClip.ClipExtrapolation)(kind-8));}
                    if(kind==13){c.easeInDuration=.2;c.easeOutDuration=.2;c.mixInCurve=AnimationCurve.Linear(0,0,1,1);c.mixOutCurve=AnimationCurve.Linear(0,1,1,0);c.blendInCurveMode=TimelineClip.BlendCurveMode.Manual;c.blendOutCurveMode=TimelineClip.BlendCurveMode.Manual;}
                }
            }
            AssetDatabase.SaveAssets();PrefabUtility.SaveAsPrefabAsset(root,stem+".prefab");
            var row=new Case {label=label,prefab=stem+".prefab",duration=timeline.duration};director.Play();
            foreach(double t in new double[]{0,.249999,.25,.3,.4,.5,.6,.749999,.75,.9,.999999,1,1.25,2,2.25,3}){
                director.time=t;director.Evaluate();var sample=new Sample {time=t,directorTime=director.time,active=target.activeSelf,position=target.transform.localPosition,state=director.state.ToString(),starts=receiver?receiver.starts:0,stops=receiver?receiver.stops:0,controlSamples=receiver?receiver.samples:0,controlTime=receiver?receiver.time:0,particles=particles?particles.particleCount:0,particleTime=particles?particles.time:0,nestedTime=nested?nested.time:0};foreach(var ps in root.GetComponentsInChildren<ParticleSystem>(true))sample.systems.Add(new SystemSample {name=ps.name,count=ps.particleCount,time=ps.time,seed=ps.randomSeed});row.samples.Add(sample);
            }
            director.Stop();row.stoppedActive=target.activeSelf;row.stoppedPosition=target.transform.localPosition;output.cases.Add(row);retained.Add(root);
        }
        var metadata=new Metadata();
        foreach(var guid in AssetDatabase.FindAssets("t:MonoScript",new[]{"Assets/TimelineRuntime","Assets/TimelineProbeSource"})) {
            var script=AssetDatabase.LoadAssetAtPath<MonoScript>(AssetDatabase.GUIDToAssetPath(guid));var type=script.GetClass();if(type==null)continue;
            metadata.scripts.Add(new ScriptIdentity {guid=guid,file_id="11500000",assembly=type.Assembly.GetName().Name,@namespace=type.Namespace,class_name=type.Name});
        }
        File.WriteAllText(Folder+"/timeline.monoscripts.json",JsonUtility.ToJson(metadata,true));
        AssetDatabase.SaveAssets();
        int ticks=0;
        EditorApplication.CallbackFunction settle=null;
        settle=()=>{
            if(++ticks<3)return;
            EditorApplication.update-=settle;
            for(int i=0;i<retained.Count;i++){output.cases[i].settledActive=retained[i].transform.Find("target").gameObject.activeSelf;UnityEngine.Object.DestroyImmediate(retained[i]);}
            File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(output,true));EditorApplication.Exit(0);
        };
        EditorApplication.update+=settle;
    }
}
