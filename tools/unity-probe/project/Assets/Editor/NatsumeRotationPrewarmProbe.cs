using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeRotationPrewarmProbe
{
    [Serializable] public class Sample {public int frame,count; public float time; public Vector3[] rotations; public float[] remaining;}
    [Serializable] public class Result {public string label;public float speed;public Sample[] samples;}
    [Serializable] public class Output {public string unityVersion;public Result[] cases;}
    static Result Measure(string label, bool prewarm, bool axes, bool curve, float lifetime = 2, float duration = 1, float speed = 1)
    {
        var go=new GameObject(label);
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            var m=ps.main;m.duration=1;m.loop=prewarm;m.prewarm=prewarm;m.playOnAwake=false;m.startLifetime=2;m.startSpeed=0;m.startRotation3D=true;m.startRotationX=10*Mathf.Deg2Rad;m.startRotationY=20*Mathf.Deg2Rad;m.startRotationZ=30*Mathf.Deg2Rad;m.maxParticles=100;m.gravityModifier=0;m.simulationSpace=ParticleSystemSimulationSpace.Local;m.scalingMode=ParticleSystemScalingMode.Local;
            var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=prewarm;emission.rateOverTime=10;
            var r=ps.rotationOverLifetime;r.enabled=!prewarm;r.separateAxes=axes;
            if(axes){r.x=1;r.y=-2;}
            r.z=curve ? new ParticleSystem.MinMaxCurve(1,new AnimationCurve(new Keyframe(0,0,2,2),new Keyframe(1,2,2,2))) : new ParticleSystem.MinMaxCurve(3);
            ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            m.startLifetime=lifetime;m.duration=duration;m.simulationSpeed=speed;
            if(label=="prewarm-direct-curve")m.startLifetime=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,1,1,2));
            if(!label.StartsWith("prewarm-direct"))ps.Simulate(0,false,true,false);
            else ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            if(prewarm)ps.Play(false);else ps.Emit(1);
            var samples=new List<Sample>();
            for(int frame=0;frame<=60;frame++){
                if(frame>0)ps.Simulate(1f/60,false,false,false);
                if(frame!=0&&frame!=1&&frame!=30&&frame!=60)continue;
                var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
                samples.Add(new Sample{frame=frame,time=ps.time,count=particles.Length,rotations=particles.Select(p=>p.rotation3D).ToArray(),remaining=particles.Select(p=>p.remainingLifetime).ToArray()});
            }
            return new Result{label=label,speed=speed,samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var results=new[]{Measure("rotation-z",false,false,false),Measure("rotation-xyz",false,true,false),Measure("rotation-curve",false,false,true),Measure("prewarm",true,false,false),Measure("prewarm-direct",true,false,false),Measure("prewarm-direct-curve",true,false,false),Measure("prewarm-direct-long",true,false,false,4),Measure("prewarm-direct-duration3-life1",true,false,false,1,3),Measure("prewarm-direct-duration3-life2",true,false,false,2,3),Measure("prewarm-direct-duration3-life4",true,false,false,4,3),Measure("rotation-speed-zero",false,false,false,2,1,0),Measure("rotation-speed-half",false,false,false,2,1,0.5f),Measure("rotation-speed-double",false,false,false,4,1,2),Measure("prewarm-direct-speed-zero",true,false,false,2,1,0),Measure("prewarm-direct-speed-half",true,false,false,2,1,0.5f),Measure("prewarm-direct-speed-double",true,false,false,2,1,2)};
        string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/rotation-prewarm"));Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=results},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
