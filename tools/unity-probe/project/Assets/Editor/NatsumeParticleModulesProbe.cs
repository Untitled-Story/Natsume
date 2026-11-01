using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeParticleModulesProbe
{
    [Serializable] public class Sample {
        public int frame, count;
        public Vector3 position, velocity, totalVelocity;
        public float lifetime, remaining;
        public Color color;
    }
    [Serializable] public class Case {
        public string kind;
        public int mode, combo;
        public bool local, rotated;
        public float dt, speed;
        public Vector2 range;
        public Quaternion rotation;
        public Vector3 scale;
        public Sample[] samples;
    }
    [Serializable] public class RandomSample { public int frame; public Vector3 mean, variance, covariance; }
    [Serializable] public class RandomCase { public bool perFrame, curves; public float dt; public RandomSample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; public RandomCase[] random; }
    static ParticleSystem.MinMaxCurve Curve(float a, float b) {
        var c=AnimationCurve.Linear(0,a,1,b);
        var p=new ParticleSystem.MinMaxCurve(1,c,c);p.mode=ParticleSystemCurveMode.Curve;return p;
    }
    static Gradient Colors() {
        var g=new Gradient();
        g.SetKeys(new[]{new GradientColorKey(new Color(0.2f,0.4f,1.6f),0),new GradientColorKey(new Color(1.4f,0.8f,0.1f),1)},new[]{new GradientAlphaKey(0.25f,0),new GradientAlphaKey(0.9f,1)});
        return g;
    }
    static Case Measure(string kind,int mode,int combo,bool local,bool rotated,float dt,float speed,Vector2 range,bool scaled=false) {
        Debug.Log($"particle-modules {kind} mode={mode} combo={combo} local={local} rotated={rotated} dt={dt}");
        var go=new GameObject("particle-modules-probe");
        try {
            go.transform.rotation=rotated?Quaternion.Euler(20,35,50):Quaternion.identity;
            go.transform.localScale=scaled?new Vector3(2,0.5f,1.5f):Vector3.one;
            var ps=go.AddComponent<ParticleSystem>();
            ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            var main=ps.main;main.playOnAwake=false;main.loop=false;main.duration=4;
            main.startLifetime=4;main.startSpeed=0;main.startSize=1;main.startColor=Color.white;
            main.simulationSpace=local?ParticleSystemSimulationSpace.Local:ParticleSystemSimulationSpace.World;
            main.scalingMode=ParticleSystemScalingMode.Local;
            main.emitterVelocityMode=ParticleSystemEmitterVelocityMode.Custom;
            var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.enabled=false;
            ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            if(kind=="force") {
                var f=ps.forceOverLifetime;f.enabled=true;f.space=mode<2?ParticleSystemSimulationSpace.Local:ParticleSystemSimulationSpace.World;
                bool curve=mode%2==1;f.x=curve?Curve(0.4f,2.4f):new ParticleSystem.MinMaxCurve(1.2f);
                f.y=curve?Curve(-1,2):new ParticleSystem.MinMaxCurve(-0.7f);f.z=curve?Curve(0.3f,0.3f):new ParticleSystem.MinMaxCurve(0.3f);
                f.randomized=false;
            }
            if(kind=="color") {var c=ps.colorBySpeed;c.enabled=true;c.range=range;c.color=new ParticleSystem.MinMaxGradient(Colors());}
            if(kind=="lifetime") {var l=ps.lifetimeByEmitterSpeed;l.enabled=true;l.range=range;l.curve=mode==0?new ParticleSystem.MinMaxCurve(1.5f):Curve(0.4f,2.4f);}
            if(kind=="inherit") {var v=ps.inheritVelocity;v.enabled=true;v.mode=(ParticleSystemInheritVelocityMode)mode;v.curve=combo==0?new ParticleSystem.MinMaxCurve(0.7f):Curve(0.2f,1.2f);}
            if(combo>0&&kind!="inherit") {var v=ps.velocityOverLifetime;v.enabled=true;v.space=ParticleSystemSimulationSpace.Local;v.x=0.6f;v.y=-0.3f;v.speedModifier=1.3f;}
            ps.Simulate(0,false,true,false);main.emitterVelocity=new Vector3(speed*0.6f,speed*0.8f,0);
            if(kind=="lifetime"||kind=="inherit")ps.Emit(1);
            else ps.SetParticles(new[]{new ParticleSystem.Particle{position=new Vector3(0.2f,-0.1f,0.3f),velocity=new Vector3(speed*0.6f,speed*0.8f,0),startLifetime=4,remainingLifetime=4,startSize=1,randomSeed=12345,startColor=Color.white}},1);
            var samples=new List<Sample>();var particles=new ParticleSystem.Particle[4];
            for(int frame=0;frame<=12;frame++) {
                if(frame>0) {
                    main.emitterVelocity=new Vector3(speed*0.6f,speed*0.8f,0)*(frame<=6?1:-0.5f);
                    ps.Simulate(dt,false,false,false);
                }
                int count=ps.GetParticles(particles);var p=particles[0];
                if(frame==0||frame==1||frame==2||frame==6||frame==7||frame==12)samples.Add(new Sample{frame=frame,count=count,position=p.position,velocity=p.velocity,totalVelocity=p.totalVelocity,lifetime=p.startLifetime,remaining=p.remainingLifetime,color=p.GetCurrentColor(ps)});
            }
            return new Case{kind=kind,mode=mode,combo=combo,local=local,rotated=rotated,dt=dt,speed=speed,range=range,rotation=go.transform.rotation,scale=go.transform.localScale,samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    static RandomCase RandomForce(bool perFrame,bool curves,float dt) {
        var go=new GameObject("random-force");
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            var main=ps.main;main.playOnAwake=false;main.loop=false;main.startLifetime=4;main.startSpeed=0;main.maxParticles=4096;
            var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;
            var f=ps.forceOverLifetime;f.enabled=true;f.randomized=perFrame;
            if(curves) {
                f.x=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.2f,1,0.6f),AnimationCurve.Linear(0,1.8f,1,2.4f));
                f.y=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,-0.5f,1,0.1f),AnimationCurve.Linear(0,2.5f,1,3.5f));
                f.z=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.4f,1,0.5f),AnimationCurve.Linear(0,1.2f,1,1.7f));
            } else {f.x=new ParticleSystem.MinMaxCurve(0.2f,1.8f);f.y=new ParticleSystem.MinMaxCurve(-0.5f,2.5f);f.z=new ParticleSystem.MinMaxCurve(0.4f,1.2f);}
            ps.Simulate(0,false,true,false);var particles=new ParticleSystem.Particle[4096];
            for(int i=0;i<particles.Length;i++)particles[i]=new ParticleSystem.Particle{startLifetime=4,remainingLifetime=4,startSize=1,startColor=Color.white,randomSeed=(uint)(12345+i*7919)};
            ps.SetParticles(particles,particles.Length);var samples=new List<RandomSample>();
            for(int frame=1;frame<=12;frame++) {
                ps.Simulate(dt,false,false,false);if(frame!=1&&frame!=2&&frame!=6&&frame!=12)continue;
                int n=ps.GetParticles(particles);Vector3 sum=Vector3.zero,sum2=Vector3.zero,cross=Vector3.zero;
                foreach(var p in particles){var v=p.velocity;sum+=v;sum2+=Vector3.Scale(v,v);cross+=new Vector3(v.x*v.y,v.y*v.z,v.z*v.x);}
                var mean=sum/n;var variance=sum2/n-Vector3.Scale(mean,mean);var covariance=cross/n-new Vector3(mean.x*mean.y,mean.y*mean.z,mean.z*mean.x);
                samples.Add(new RandomSample{frame=frame,mean=mean,variance=variance,covariance=covariance});
            }
            return new RandomCase{perFrame=perFrame,curves=curves,dt=dt,samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var rows=new List<Case>();
        foreach(bool local in new[]{false,true})foreach(bool rotated in new[]{false,true})foreach(float dt in new[]{0.005f,1f/60,0.025f})foreach(int mode in new[]{0,1,2,3})foreach(int combo in new[]{0,1})foreach(bool scaled in new[]{false,true})rows.Add(Measure("force",mode,combo,local,rotated,dt,2,new Vector2(0,4),scaled));
        foreach(var range in new[]{new Vector2(0,4),new Vector2(1,3),new Vector2(2,2),new Vector2(0,0),new Vector2(0.5f,0.5f)})foreach(float speed in new[]{0,0.5f,1,2,4,7})foreach(int combo in new[]{0,1})rows.Add(Measure("color",0,combo,true,false,1f/60,speed,range));
        foreach(var range in new[]{new Vector2(0,4),new Vector2(1,3),new Vector2(2,2),new Vector2(0,0),new Vector2(0.5f,0.5f)})foreach(float speed in new[]{0,0.5f,1,2,4,7})foreach(int mode in new[]{0,1})rows.Add(Measure("lifetime",mode,0,false,false,1f/60,speed,range));
        foreach(bool local in new[]{false,true})foreach(bool rotated in new[]{false,true})foreach(int mode in new[]{0,1})foreach(int combo in new[]{0,1})rows.Add(Measure("inherit",mode,combo,local,rotated,1f/60,3,new Vector2(0,4)));
        var random=new List<RandomCase>();foreach(bool perFrame in new[]{false,true})foreach(bool curves in new[]{false,true})foreach(float dt in new[]{0.005f,1f/60})random.Add(RandomForce(perFrame,curves,dt));
        string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/particle-modules"));Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=rows.ToArray(),random=random.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
