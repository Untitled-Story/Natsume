using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeSubEmitterProbe
{
    [Serializable] public class Particle { public Vector3 position,velocity,size,rotation; public Color color; public float lifetime,remaining; public uint seed; }
    [Serializable] public class Sample { public int frame; public Particle[] parent,child; }
    [Serializable] public class Case { public int eventType,inherit,space,kind; public bool emission,play; public float probability; public Sample[] samples; }
    [Serializable] public class Endpoint { public float remaining,step; public int count; public Particle[] particles; }
    [Serializable] public class Lifecycle { public string name; public int inherit; public float lifetime,duration,childLifetime; public bool loop; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; public Endpoint[] endpoints; public Lifecycle[] lifecycle; }
    static Endpoint End(float remaining,float step) {
        var go=new GameObject("endpoint");
        try {
            var ps=Make(go,false,false,false,1);ps.Simulate(0,false,true,false);
            var particle=new ParticleSystem.Particle { position=Vector3.zero,velocity=Vector3.zero,startLifetime=1,remainingLifetime=remaining,startSize=1,startColor=Color.white,randomSeed=1 };
            ps.SetParticles(new[]{particle},1);ps.Simulate(step,false,false,false);
            return new Endpoint { remaining=remaining,step=step,count=ps.particleCount,particles=Read(ps) };
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    static Particle[] Read(ParticleSystem ps) {
        var particles=new ParticleSystem.Particle[ps.particleCount]; ps.GetParticles(particles);
        var result=new Particle[particles.Length];
        for(int i=0;i<result.Length;i++){var p=particles[i];result[i]=new Particle{position=p.position,velocity=p.totalVelocity,size=p.GetCurrentSize3D(ps),rotation=p.rotation3D,color=p.GetCurrentColor(ps),lifetime=p.startLifetime,remaining=p.remainingLifetime,seed=p.randomSeed};}
        return result;
    }
    static ParticleSystem Make(GameObject go,bool parent,bool emission,bool play,int space) {
        var p=go.AddComponent<ParticleSystem>();p.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);p.useAutoRandomSeed=false;p.randomSeed=parent?12345u:54321u;
        var m=p.main;m.loop=false;m.duration=2;m.playOnAwake=play;m.startLifetime=parent?0.1f:0.8f;m.startSpeed=0;m.startSize=parent?2:0.4f;m.startRotation=parent?0.5f:0.2f;m.startColor=parent?new Color(0.2f,0.4f,0.6f,0.8f):new Color(0.5f,0.6f,0.7f,0.5f);m.simulationSpace=(ParticleSystemSimulationSpace)space;
        var sh=p.shape;sh.enabled=false;var e=p.emission;e.enabled=emission;e.rateOverTime=0;e.SetBursts(new[]{new ParticleSystem.Burst(0,2)});p.GetComponent<ParticleSystemRenderer>().enabled=false;
        return p;
    }
    static Case Measure(int type,int inherit,int space,bool emission,bool play,float probability,int kind=0) {
        var go=new GameObject("parent");var childGO=new GameObject("child");childGO.transform.SetParent(go.transform);go.transform.position=new Vector3(3,4,5);childGO.transform.localPosition=new Vector3(7,8,9);
        try {
            var parent=Make(go,true,false,false,0);var child=Make(childGO,false,emission,play,space);
            if(kind>0){var cm=child.main;cm.duration=0.2f;cm.loop=kind==3;cm.startDelay=kind==5?0.05f:0;
                var ce=child.emission;ce.rateOverTime=kind==2?0:30;ce.SetBursts(kind==2?new[]{new ParticleSystem.Burst(0.05f,2)}:new ParticleSystem.Burst[0]);
                var pm=parent.main;pm.startLifetime=0.5f;}
            var sub=parent.subEmitters;sub.enabled=true;sub.AddSubEmitter(child,(ParticleSystemSubEmitterType)type,(ParticleSystemSubEmitterProperties)inherit,probability);
            parent.Simulate(0,true,true,false);
            var ep=new ParticleSystem.EmitParams();ep.position=new Vector3(0.2f,0.3f,0.4f);ep.velocity=new Vector3(1,2,3);parent.Emit(ep,1);
            var rows=new List<Sample>();
            rows.Add(new Sample{frame=0,parent=Read(parent),child=Read(child)});
            if(type==4)parent.TriggerSubEmitter(0);
            for(int frame=1;frame<=60;frame++){
                parent.Simulate(1f/60,true,false,false);
                rows.Add(new Sample{frame=frame,parent=Read(parent),child=Read(child)});
            }
            return new Case{kind=kind,eventType=type,inherit=inherit,space=space,emission=emission,play=play,probability=probability,samples=rows.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    static Lifecycle Life(string name,int inherit,float lifetime,float duration,bool loop,float childLifetime=0.8f) {
        var go=new GameObject(name);var childGO=new GameObject("child");childGO.transform.SetParent(go.transform);
        try {
            var parent=Make(go,true,true,false,0);var child=Make(childGO,false,false,false,0);
            var pm=parent.main;pm.startLifetime=lifetime;pm.duration=1;pm.loop=name=="prewarm";pm.prewarm=name=="prewarm";
            var pe=parent.emission;pe.rateOverTime=name=="prewarm"?10:0;pe.SetBursts(new ParticleSystem.Burst[0]);
            var cm=child.main;cm.duration=duration;cm.loop=loop;cm.startLifetime=childLifetime;
            var ce=child.emission;ce.rateOverTime=name=="distance"?0:30;ce.rateOverDistance=name=="distance"?10:0;
            ce.SetBursts(name=="prewarm"?new[]{new ParticleSystem.Burst(0,2)}:new ParticleSystem.Burst[0]);
            if(name=="prewarm")ce.rateOverTime=0;
            var sub=parent.subEmitters;sub.enabled=true;sub.AddSubEmitter(child,ParticleSystemSubEmitterType.Birth,(ParticleSystemSubEmitterProperties)inherit);
            if(name=="prewarm")parent.Play(false);
            else {parent.Simulate(0,true,true,false);var ep=new ParticleSystem.EmitParams();ep.position=Vector3.zero;ep.velocity=new Vector3(1,2,3);parent.Emit(ep,1);}
            var rows=new List<Sample>();rows.Add(new Sample{frame=0,parent=Read(parent),child=Read(child)});
            for(int frame=1;frame<=120;frame++){parent.Simulate(1f/60,true,false,false);rows.Add(new Sample{frame=frame,parent=Read(parent),child=Read(child)});}
            return new Lifecycle{name=name,inherit=inherit,lifetime=lifetime,duration=duration,childLifetime=childLifetime,loop=loop,samples=rows.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var cases=new List<Case>();
        foreach(int type in new[]{0,2,4})foreach(int inherit in new[]{0,1,2,4,8,16,31})foreach(int space in new[]{0,1})
            cases.Add(Measure(type,inherit,space,true,false,1));
        foreach(int type in new[]{0,2,4})foreach(bool emission in new[]{false,true})foreach(bool play in new[]{false,true})foreach(float probability in new[]{0,0.5f,1})
            cases.Add(Measure(type,0,0,emission,play,probability));
        foreach(int type in new[]{0,2,4})foreach(int inherit in new[]{0,16})foreach(int kind in new[]{1,2,3,5})
            cases.Add(Measure(type,inherit,0,true,false,1,kind));
        var endpoints=new List<Endpoint>();
        foreach(float step in new[]{0.01f,1f/60,0.025f})foreach(float excess in new[]{-1e-5f,0f,1e-8f,1e-7f,1e-6f,1e-5f,0.001f})endpoints.Add(End(step+excess,step));
        var lifecycle=new List<Lifecycle>();
        foreach(float life in new[]{0.1f,0.5f,2f})foreach(float duration in new[]{0.2f,1f})foreach(bool loop in new[]{false,true})foreach(int inherit in new[]{0,16})lifecycle.Add(Life("duration",inherit,life,duration,loop));
        foreach(float life in new[]{0.1f,0.5f,2f})lifecycle.Add(Life("prewarm",0,life,0.2f,false));
        foreach(float life in new[]{0.1f,0.5f,2f})foreach(float childLife in new[]{0.2f,2f,4f})lifecycle.Add(Life("prewarm",0,life,0.2f,false,childLife));
        foreach(int inherit in new[]{0,16})lifecycle.Add(Life("distance",inherit,0.5f,0.2f,true));
        var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray(),endpoints=endpoints.ToArray(),lifecycle=lifecycle.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
