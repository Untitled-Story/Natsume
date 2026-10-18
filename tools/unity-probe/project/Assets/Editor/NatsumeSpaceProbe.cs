using System;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEditor;

public static class NatsumeSpaceProbe
{
    [Serializable] public class Sample { public int frame; public Vector3 position, velocity, world; }
    [Serializable] public class Case { public string label; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    static Case Measure(string label)
    {
        var go=new GameObject(label); var custom=new GameObject("Custom frame");
        var previousGravity=Physics.gravity;
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            go.transform.position=new Vector3(2,3,0);go.transform.rotation=Quaternion.Euler(0,0,90);go.transform.localScale=new Vector3(2,3,1);
            custom.transform.position=new Vector3(-1,2,0);custom.transform.rotation=Quaternion.Euler(0,0,45);
            var m=ps.main;m.playOnAwake=false;m.startLifetime=2;m.startSpeed=1;m.startSize=1;m.scalingMode=ParticleSystemScalingMode.Local;
            m.simulationSpace=label.StartsWith("world")?ParticleSystemSimulationSpace.World:label.StartsWith("custom")?ParticleSystemSimulationSpace.Custom:ParticleSystemSimulationSpace.Local;
            m.customSimulationSpace=custom.transform;
            var e=ps.emission;e.enabled=false;var s=ps.shape;s.enabled=false;
            if(label.Contains("gravity")){m.gravityModifier=1;Physics.gravity=new Vector3(0,-10,0);}
            if(label.Contains("velocity")){var v=ps.velocityOverLifetime;v.enabled=true;v.space=ParticleSystemSimulationSpace.World;v.x=1;v.y=2;v.z=0;}
            ps.Simulate(0,false,true,false);ps.Emit(1);
            var particles=new ParticleSystem.Particle[1];var samples=new Sample[3];
            for(int frame=0;frame<3;frame++){
                if(frame>0){go.transform.position+=Vector3.right;custom.transform.position+=Vector3.up;ps.Simulate(1f/60,false,false,false);}
                ps.GetParticles(particles);var p=particles[0];
                var world=m.simulationSpace==ParticleSystemSimulationSpace.World?p.position:m.simulationSpace==ParticleSystemSimulationSpace.Custom?custom.transform.TransformPoint(p.position):go.transform.TransformPoint(p.position);
                samples[frame]=new Sample {frame=frame,position=p.position,velocity=p.velocity,world=world};
            }
            return new Case {label=label,samples=samples};
        }finally{Physics.gravity=previousGravity;UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(custom);}
    }
    public static void Run(){try{
        var output=new Output {unityVersion=Application.unityVersion,cases=new[]{"local","world","custom","local-gravity","world-gravity","custom-gravity","local-velocity","world-velocity","custom-velocity"}.Select(Measure).ToArray()};
        var directory=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/spaces"));Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
