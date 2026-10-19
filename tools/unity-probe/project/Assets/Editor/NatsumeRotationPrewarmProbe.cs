using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeRotationPrewarmProbe
{
    [Serializable] public class Sample {public int frame,count; public float time; public Vector3[] rotations, positions, velocities; public Vector4[] custom; public float[] remaining, lifetimes;public uint[] seeds;}
    [Serializable] public class Result {public string label;public float speed, duration, lifetime, rate, dt;public bool lifetimeCurve;public Sample[] samples;}
    [Serializable] public class Output {public string unityVersion;public Result[] cases;}
    static Result Measure(string label, bool prewarm, bool axes, bool curve, float lifetime = 2, float duration = 1, float speed = 1, float rate = 10, float dt = 1f/60, bool everyFrame = false)
    {
        var go=new GameObject(label);
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            var m=ps.main;m.duration=1;m.loop=prewarm;m.prewarm=prewarm;m.playOnAwake=false;m.startLifetime=2;m.startSpeed=0;m.startRotation3D=true;m.startRotationX=10*Mathf.Deg2Rad;m.startRotationY=20*Mathf.Deg2Rad;m.startRotationZ=30*Mathf.Deg2Rad;m.maxParticles=100;m.gravityModifier=label.Contains("gravity")?1:0;m.simulationSpace=ParticleSystemSimulationSpace.Local;m.scalingMode=ParticleSystemScalingMode.Local;
            if (label.Contains("gravity")) {
                var custom=ps.customData; custom.enabled=true;
                custom.SetMode(ParticleSystemCustomData.Custom1,ParticleSystemCustomDataMode.Vector);
                custom.SetVectorComponentCount(ParticleSystemCustomData.Custom1,1);
                custom.SetVector(ParticleSystemCustomData.Custom1,0,new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0,1,1)));
            }
            var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=prewarm;emission.rateOverTime=rate;
            var r=ps.rotationOverLifetime;r.enabled=!prewarm;r.separateAxes=axes;
            if(axes){r.x=1;r.y=-2;}
            r.z=curve ? new ParticleSystem.MinMaxCurve(1,new AnimationCurve(new Keyframe(0,0,2,2),new Keyframe(1,2,2,2))) : new ParticleSystem.MinMaxCurve(3);
            ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            m.startLifetime=lifetime;m.duration=duration;m.simulationSpeed=speed;
            if(label.StartsWith("prewarm-direct-boundary-"))m.maxParticles=1024;
            if(label.Contains("lifetime-curve")||label=="prewarm-direct-curve")m.startLifetime=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,lifetime/2,1,lifetime));
            if(!label.StartsWith("prewarm-direct"))ps.Simulate(0,false,true,false);
            else ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            if(prewarm)ps.Play(false);else ps.Emit(1);
            var samples=new List<Sample>();
            for(int frame=0;frame<=60;frame++){
                if(frame>0)ps.Simulate(dt,false,false,false);
                if(!everyFrame&&frame!=0&&frame!=1&&frame!=30&&frame!=60)continue;
                var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
                var customValues=new List<Vector4>(); if(label.Contains("gravity"))ps.GetCustomParticleData(customValues,ParticleSystemCustomData.Custom1);
                samples.Add(new Sample{seeds=particles.Select(p=>p.randomSeed).ToArray(),custom=customValues.ToArray(),frame=frame,time=ps.time,count=particles.Length,rotations=particles.Select(p=>p.rotation3D).ToArray(),remaining=particles.Select(p=>p.remainingLifetime).ToArray(),lifetimes=particles.Select(p=>p.startLifetime).ToArray(),positions=label.Contains("gravity")?particles.Select(p=>p.position).ToArray():new Vector3[0],velocities=label.Contains("gravity")?particles.Select(p=>p.velocity).ToArray():new Vector3[0]});
            }
            return new Result{label=label,dt=dt,speed=speed,duration=duration,lifetime=lifetime,rate=rate,lifetimeCurve=label.Contains("lifetime-curve")||label=="prewarm-direct-curve",samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var results=new List<Result>{Measure("rotation-z",false,false,false),Measure("rotation-xyz",false,true,false),Measure("rotation-curve",false,false,true),Measure("prewarm",true,false,false),Measure("prewarm-direct",true,false,false),Measure("prewarm-direct-curve",true,false,false),Measure("prewarm-direct-long",true,false,false,4),Measure("prewarm-direct-duration3-life1",true,false,false,1,3),Measure("prewarm-direct-duration3-life2",true,false,false,2,3),Measure("prewarm-direct-duration3-life4",true,false,false,4,3),Measure("rotation-speed-zero",false,false,false,2,1,0),Measure("rotation-speed-half",false,false,false,2,1,0.5f),Measure("rotation-speed-double",false,false,false,4,1,2),Measure("prewarm-direct-speed-zero",true,false,false,2,1,0),Measure("prewarm-direct-speed-half",true,false,false,2,1,0.5f),Measure("prewarm-direct-speed-double",true,false,false,2,1,2),Measure("prewarm-direct-gravity",true,false,false),Measure("prewarm-direct-lifetime-curve-long",true,false,false,4,1),Measure("prewarm-direct-lifetime-curve-duration3",true,false,false,2,3),Measure("prewarm-direct-rate17",true,false,false,2,1,1,17)};
        foreach (float duration in new [] {0.7f,2.3f})
            foreach (float life in new [] {1.3f,3.7f})
                foreach (float rate in new [] {7f,17f})
                    foreach (bool curve in new [] {false,true}) {
                        string label="prewarm-direct-grid-"+duration+"-"+life+"-"+rate+(curve?"-lifetime-curve":"");
                        results.Add(Measure(label,true,false,false,life,duration,1,rate));
                    }
        foreach (float speed in new [] {0.5f,2f})
            foreach (float rate in new [] {7f,17f})
                results.Add(Measure("prewarm-direct-speed-grid-"+speed+"-"+rate,true,false,false,1.3f,0.7f,speed,rate));
        foreach(float duration in new [] {0.83f,1.17f})
            foreach(float life in new [] {0.5f,1.37f,2.13f})
                foreach(bool curve in new [] {false,true})
                    foreach(float speed in new [] {0.5f,2f})
                        results.Add(Measure("prewarm-direct-window-"+duration+"-"+life+"-"+speed+(curve?"-lifetime-curve":""),true,false,false,life,duration,speed,11));
        foreach(float dt in new [] {0.005f,0.025f,0.05f})
            results.Add(Measure("prewarm-direct-window-step-"+dt,true,false,false,0.5f,1,1,17,dt));
        foreach(float duration in new [] {0.7f,1f,2.3f})
            foreach(float life in new [] {1.3f,3.7f,4f})
                foreach(float rate in new [] {7f,11f,17f,23f,60f,120f})
                    results.Add(Measure("prewarm-direct-boundary-"+duration+"-"+life+"-"+rate+"-lifetime-curve",true,false,false,life,duration,1,rate,1f/60,true));
        string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/rotation-prewarm"));Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=results.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
