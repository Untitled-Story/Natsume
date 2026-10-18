using System;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEditor;
public static class NatsumeSweepProbe
{
    [Serializable] public class Sample {public float time;public Vector3 position,rotation;}
    [Serializable] public class Case {public string label;public Sample[] samples;}
    [Serializable] public class Output {public string unityVersion;public Case[] cases;}
    static Case Measure(string label){var go=new GameObject(label);try{
        var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
        var m=ps.main;m.playOnAwake=false;m.duration=3;m.startSpeed=0;m.startLifetime=10;m.simulationSpace=ParticleSystemSimulationSpace.Local;
        var e=ps.emission;e.enabled=false;var s=ps.shape;s.enabled=true;s.shapeType=label.StartsWith("edge")?ParticleSystemShapeType.SingleSidedEdge:label.StartsWith("cone")?ParticleSystemShapeType.Cone:ParticleSystemShapeType.Circle;
        s.radius=2;s.radiusThickness=0;s.arc=180;s.arcMode=label.Contains("pingpong")?ParticleSystemShapeMultiModeValue.PingPong:ParticleSystemShapeMultiModeValue.Loop;
        s.arcSpeed=0.5f;s.arcSpread=label.Contains("spread")?0.25f:0;
        if(label.StartsWith("edge")){s.radiusMode=s.arcMode;s.radiusSpeed=0.5f;s.radiusSpread=s.arcSpread;}
        if(label.Contains("aligned")){s.alignToDirection=true;m.startRotation3D=true;m.startRotationX=10*Mathf.Deg2Rad;m.startRotationY=20*Mathf.Deg2Rad;m.startRotationZ=30*Mathf.Deg2Rad;}
        ps.Simulate(0,false,true,false);var samples=new Sample[9];
        for(int i=0;i<9;i++){if(i>0)ps.Simulate(0.25f,false,false,false);ps.Emit(1);var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);samples[i]=new Sample{time=i*0.25f,position=particles[particles.Length-1].position,rotation=particles[particles.Length-1].rotation3D};}
        return new Case{label=label,samples=samples};
    }finally{UnityEngine.Object.DestroyImmediate(go);}}
    public static void Run(){try{var output=new Output{unityVersion=Application.unityVersion,cases=new[]{"circle-loop","circle-pingpong","circle-spread","cone-loop","edge-loop","edge-pingpong","edge-spread","edge-aligned","circle-aligned"}.Select(Measure).ToArray()};var directory=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/sweeps"));Directory.CreateDirectory(directory);File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
