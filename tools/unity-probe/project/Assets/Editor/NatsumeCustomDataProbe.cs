using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeCustomDataProbe
{
    [Serializable] public class Sample {public int frame;public Vector4 custom1,custom2;}
    [Serializable] public class Case {public int components;public Sample[] samples;}
    [Serializable] public class Output {public string unityVersion;public Case[] cases;}
    static Case Measure(int components)
    {
        var go = new GameObject("Custom data");
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            var main=ps.main;main.playOnAwake=false;main.simulationSpace=ParticleSystemSimulationSpace.Local;
            var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;
            var c=ps.customData;c.enabled=true;c.SetMode(ParticleSystemCustomData.Custom1,ParticleSystemCustomDataMode.Vector);
            c.SetVectorComponentCount(ParticleSystemCustomData.Custom1,components);
            c.SetVector(ParticleSystemCustomData.Custom1,0,new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0,1,1)));
            for(int i=1;i<components;i++)c.SetVector(ParticleSystemCustomData.Custom1,i,i+1);
            c.SetMode(ParticleSystemCustomData.Custom2,ParticleSystemCustomDataMode.Color);
            c.SetColor(ParticleSystemCustomData.Custom2,new ParticleSystem.MinMaxGradient(new Color(2,-0.2f,0.4f,0.5f)));
            ps.Simulate(0,false,true,false);ps.SetParticles(new[]{new ParticleSystem.Particle{position=Vector3.zero,startSize=1,startLifetime=1,remainingLifetime=1,startColor=Color.white,randomSeed=1000}},1);
            var a=new List<Vector4>();var b=new List<Vector4>();var samples=new List<Sample>();
            for(int frame=0;frame<=30;frame++){
                if(frame>0)ps.Simulate(1f/60f,false,false,false);
                if(frame!=1&&frame!=15&&frame!=30)continue;
                ps.GetCustomParticleData(a,ParticleSystemCustomData.Custom1);ps.GetCustomParticleData(b,ParticleSystemCustomData.Custom2);
                samples.Add(new Sample{frame=frame,custom1=a[0],custom2=b[0]});
            }
            return new Case{components=components,samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var output=new Output{unityVersion=Application.unityVersion,cases=new[]{1,2,3,4}.Select(Measure).ToArray()};
        var directory=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/custom-data"));Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));
    }catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}}
}
