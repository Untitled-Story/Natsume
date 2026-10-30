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
    [Serializable] public class Sample { public int frame, a, b, child, invalidAgeCount; public float childTime; public float[] childAge,childX,aAge,bAge; public uint[] childSeed; public bool playingA,emittingA,playingB; public float timeA; }
    [Serializable] public class Case
    {
        public float lifetimeA, lifetimeB, duration;
        public int inherit, clearFrame,topology,stopMode,slotsA;
        public bool automatic;
        public List<Sample> samples = new List<Sample>();
        [NonSerialized] public ParticleSystem a,b,child,root;
        [NonSerialized] public int index;
    }
    [Serializable] public class Output { public string unityVersion; public int jobWorkers; public List<Case> cases = new List<Case>(); }
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
    static float[] Read(ParticleSystem ps, out int count, out int invalid) {
        var particles=new ParticleSystem.Particle[ps.main.maxParticles];count=ps.GetParticles(particles);
        var ages=new List<float>();
        for(int i=0;i<count;i++) {
            float age=particles[i].startLifetime-particles[i].remainingLifetime;
            if(!float.IsNaN(age)&&!float.IsInfinity(age))ages.Add(age);
        }
        invalid=count-ages.Count;return ages.ToArray();
    }
    Output output = new Output(); int frame, startup,caseIndex; bool begun;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;
        EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("shared-playback").AddComponent<NatsumeSubEmitterSharedPlaybackProbe>();
        EditorApplication.EnterPlaymode();
    }
    void Start() { Time.captureFramerate=60; output.unityVersion=Application.unityVersion; output.jobWorkers=Unity.Jobs.LowLevel.Unsafe.JobsUtility.JobWorkerCount; }
    void Configure(float life,float duration,int inherit,bool automatic,int clearFrame,int topology=0,int stopMode=0) {
        int selected, current=caseIndex++;
        if(int.TryParse(Environment.GetEnvironmentVariable("NATSUME_SHARED_CASE"),out selected) && selected>=0 && current!=selected)return;
        var holder=new GameObject("shared");holder.transform.SetParent(transform);
        var a=Make("a",holder.transform,life,false,2);
        var b=Make("b",holder.transform,life+.2f,false,2);
        var child=Make("child",holder.transform,.4f,automatic,duration);
        if(Environment.GetEnvironmentVariable("NATSUME_SHARED_MARKERS")=="1") {
            a.transform.localPosition=Vector3.left;
            b.transform.localPosition=Vector3.right;
        }
        var e=child.emission;e.rateOverTime=30;
        Add(a,child,inherit);
        if(topology==1)Add(a,child,inherit);else Add(b,child,inherit);
        var row=new Case {index=current,lifetimeA=life,lifetimeB=life+.2f,duration=duration,inherit=inherit,automatic=automatic,clearFrame=clearFrame,a=a,b=b,child=child,topology=topology,stopMode=stopMode,slotsA=a.subEmitters.subEmittersCount};
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
        if(Environment.GetEnvironmentVariable("NATSUME_SHARED_SINGLE")=="1") {
            Configure(.15f,.13f,16,false,0);return;
        }
        foreach(float life in new[] { .15f, .55f, 1.05f }) foreach(float duration in new[] { .13f, .37f })
        foreach(int inherit in new[] { 0, 16 }) foreach(bool automatic in new[] { false, true }) foreach(int clearFrame in new[] { 0, 12 })
            Configure(life,duration,inherit,automatic,clearFrame);
        foreach(int topology in new[]{0,1,2}) foreach(bool automatic in new[]{false,true}) foreach(int stopMode in new[]{1,2,3,4})
            Configure(.55f,2f,0,automatic,0,topology,stopMode);
    }
    [Serializable] class NativeRow { public int key; public long ptr; }
    [Serializable] class NativeMap { public List<NativeRow> rows=new List<NativeRow>(); }
    void SaveNativeMap() {
        var path=Environment.GetEnvironmentVariable("NATSUME_NATIVE_MAP");
        if(string.IsNullOrEmpty(path))return;
        var field=typeof(UnityEngine.Object).GetField("m_CachedPtr",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);
        var map=new NativeMap();
        foreach(var c in output.cases) {
            var systems=new[]{c.a,c.b,c.child,c.root};
            for(int i=0;i<systems.Length;i++)if(systems[i]!=null)
                map.rows.Add(new NativeRow {key=c.index*10+i+1,ptr=((IntPtr)field.GetValue(systems[i])).ToInt64()});
        }
        File.WriteAllText(path,JsonUtility.ToJson(map));
    }
    void Record(Case c,int index) {
        int a,b,count,invalid,unused;
        var aa=Read(c.a,out a,out unused);var ba=Read(c.b,out b,out unused);
        var ages=Read(c.child,out count,out invalid);
        var particles=new ParticleSystem.Particle[c.child.main.maxParticles];
        int detailed=c.child.GetParticles(particles);
        var xs=new float[detailed];var seeds=new uint[detailed];
        for(int i=0;i<detailed;i++){xs[i]=particles[i].position.x;seeds[i]=particles[i].randomSeed;}
        c.samples.Add(new Sample {frame=index,a=a,b=b,aAge=aa,bAge=ba,child=count,childTime=c.child.time,childAge=ages,childX=xs,childSeed=seeds,invalidAgeCount=invalid,playingA=c.a.isPlaying,emittingA=c.a.isEmitting,playingB=c.b.isPlaying,timeA=c.a.time});
    }
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
            if(!begun) {if(++startup<3)return;Begin();SaveNativeMap();begun=true;return;}
            foreach(var c in output.cases)Record(c,frame);
            if(frame<120)return;
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");
            Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
            EditorApplication.Exit(0);
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
    }
}
#endif
