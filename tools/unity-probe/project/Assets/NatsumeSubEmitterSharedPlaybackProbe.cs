#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/** Measures two independently emitting parents that share one continuous child pool. */
public sealed class NatsumeSubEmitterSharedPlaybackProbe : MonoBehaviour
{
    [Serializable] public class Sample { public int frame, a, b, child, invalidAgeCount; public float childTime; public float[] childAge; public bool playingA,emittingA,playingB; public float timeA; }
    [Serializable] public class Case
    {
        public float lifetimeA, lifetimeB, duration;
        public int inherit, clearFrame,topology,stopMode,slotsA;
        public bool automatic;
        public List<Sample> samples = new List<Sample>();
        [NonSerialized] public ParticleSystem a,b,child,root;
    }
    [Serializable] public class Output { public string unityVersion; public List<Case> cases = new List<Case>(); }
    ParticleSystem Make(string name, Transform root, float life, bool automatic, float duration)
    {
        var go = new GameObject(name); go.transform.SetParent(root, false);
        var p = go.AddComponent<ParticleSystem>(); p.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        p.useAutoRandomSeed = false; p.randomSeed = 12345;
        var m = p.main; m.playOnAwake = automatic; m.loop = false; m.duration = duration;
        m.startLifetime = life; m.startSpeed = 0; m.maxParticles = 1000;
        var shape = p.shape; shape.enabled = false;
        var e = p.emission; e.enabled = automatic; e.rateOverTime = automatic ? 30 : 0; e.SetBursts(new ParticleSystem.Burst[0]);
        p.GetComponent<ParticleSystemRenderer>().enabled = false; return p;
    }
    static void Add(ParticleSystem source, ParticleSystem target, int inherit)
    {
        var s = source.subEmitters; s.enabled = true;
        s.AddSubEmitter(target, ParticleSystemSubEmitterType.Birth, (ParticleSystemSubEmitterProperties)inherit);
    }
    static float[] Ages(ParticleSystem ps) {
        var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
        var ages=new List<float>();
        foreach(var p in particles) {float age=p.startLifetime-p.remainingLifetime;if(!float.IsNaN(age)&&!float.IsInfinity(age))ages.Add(age);}
        return ages.ToArray();
    }
    Output output = new Output(); int frame, startup; bool begun;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;
        EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("shared-playback").AddComponent<NatsumeSubEmitterSharedPlaybackProbe>();
        EditorApplication.EnterPlaymode();
    }
    void Start() { Time.captureFramerate=60; output.unityVersion=Application.unityVersion; }
    void Configure(float life,float duration,int inherit,bool automatic,int clearFrame,int topology=0,int stopMode=0) {
        var holder=new GameObject("shared");holder.transform.SetParent(transform);
        var a=Make("a",holder.transform,life,false,2);
        var b=Make("b",holder.transform,life+.2f,false,2);
        var child=Make("child",holder.transform,.4f,automatic,duration);
        var e=child.emission;e.rateOverTime=30;
        Add(a,child,inherit);
        if(topology==1)Add(a,child,inherit);else Add(b,child,inherit);
        var row=new Case {lifetimeA=life,lifetimeB=life+.2f,duration=duration,inherit=inherit,automatic=automatic,clearFrame=clearFrame,a=a,b=b,child=child,topology=topology,stopMode=stopMode,slotsA=a.subEmitters.subEmittersCount};
        if(topology==2) {
            row.root=Make("root",holder.transform,1,false,2);
            Add(row.root,a,0);Add(row.root,b,0);
            var ae=a.emission;ae.SetBursts(new[]{new ParticleSystem.Burst(0,1)});
            var be=b.emission;be.SetBursts(new[]{new ParticleSystem.Burst(0,1)});
            row.root.Play(false);row.root.Emit(1);
        } else {
            a.Play(false);a.Emit(1);
            if(topology==0){b.Play(false);b.Emit(1);}
        }
        if(automatic)child.Play(false);
        output.cases.Add(row);Record(row,0);
    }
    void Begin() {
        foreach(float life in new[] { .15f, .55f, 1.05f }) foreach(float duration in new[] { .13f, .37f })
        foreach(int inherit in new[] { 0, 16 }) foreach(bool automatic in new[] { false, true }) foreach(int clearFrame in new[] { 0, 12 })
            Configure(life,duration,inherit,automatic,clearFrame);
        foreach(int topology in new[]{0,1,2}) foreach(bool automatic in new[]{false,true}) foreach(int stopMode in new[]{1,2,3,4})
            Configure(.55f,2f,0,automatic,0,topology,stopMode);
    }
    void Record(Case c,int index) { var ages=Ages(c.child); c.samples.Add(new Sample {frame=index,a=c.a.particleCount,b=c.b.particleCount,child=c.child.particleCount,childTime=c.child.time,childAge=ages,invalidAgeCount=c.child.particleCount-ages.Length,playingA=c.a.isPlaying,emittingA=c.a.isEmitting,playingB=c.b.isPlaying,timeA=c.a.time}); }
    void Update() {
        if(!begun)return;
        frame++;
        foreach(var c in output.cases) {
            if(frame==10 && c.topology==0)c.b.Emit(1);
            if(frame==12) {
                if(c.stopMode==1 || c.stopMode==4)c.a.Stop(false,ParticleSystemStopBehavior.StopEmitting);
                if(c.stopMode==2)c.a.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                if(c.stopMode==3)c.a.gameObject.SetActive(false);
                if(c.stopMode==4)c.b.Stop(false,ParticleSystemStopBehavior.StopEmitting);
            }
            if(frame==c.clearFrame)c.a.Clear(false);
        }
    }
    void LateUpdate() {
        try {
            if(!begun) {if(++startup<3)return;Begin();begun=true;return;}
            foreach(var c in output.cases)Record(c,frame);
            if(frame<120)return;
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");
            Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
            EditorApplication.Exit(0);
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
    }
}
#endif
