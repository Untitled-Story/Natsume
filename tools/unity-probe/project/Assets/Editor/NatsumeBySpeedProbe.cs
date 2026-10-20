using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeBySpeedProbe
{
    [Serializable] public class Sample { public int frame; public Vector3 size,rotation,velocity,totalVelocity,position; }
    [Serializable] public class Case { public string label; public int mode,combo; public bool axes,holdout; public float speed,dt; public Vector2 range; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    static ParticleSystem.MinMaxCurve Parameter(int mode,float factor) {
        var a=AnimationCurve.Linear(0,0.25f*factor,1,1.75f*factor);
        switch(mode) {
            case 0:return new ParticleSystem.MinMaxCurve(1.2f*factor);
            case 1:return new ParticleSystem.MinMaxCurve(1,a);
            case 2:return new ParticleSystem.MinMaxCurve(0.4f*factor,1.6f*factor);
            default:return new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.1f*factor,1,0.8f*factor),a);
        }
    }
    static Case Measure(int index,int mode,bool axes,Vector2 range,float speed,int combo,float dt) {
        var go=new GameObject("speed-probe");
        try {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            var main=ps.main;main.playOnAwake=false;main.loop=false;main.startLifetime=4;main.startSpeed=0;main.startSize3D=true;main.startSizeX=2;main.startSizeY=3;main.startSizeZ=4;main.startRotation3D=true;main.gravityModifier=combo==1?0.5f:0;main.simulationSpace=ParticleSystemSimulationSpace.Local;main.scalingMode=ParticleSystemScalingMode.Local;
            var shape=ps.shape;shape.enabled=false;var em=ps.emission;em.enabled=false;ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            var size=ps.sizeBySpeed;size.enabled=true;size.separateAxes=axes;size.range=range;size.x=Parameter(mode,1);if(axes){size.y=Parameter(mode,0.7f);size.z=Parameter(mode,1.3f);}
            var rot=ps.rotationBySpeed;rot.enabled=true;rot.separateAxes=axes;rot.range=range;rot.z=Parameter(mode,1.1f);if(axes){rot.x=Parameter(mode,0.6f);rot.y=Parameter(mode,-0.8f);}
            if(combo==2||combo==5){var v=ps.velocityOverLifetime;v.enabled=true;v.space=ParticleSystemSimulationSpace.Local;v.x=1;v.y=2;v.z=-0.5f;v.speedModifier=1.4f;}
            if(combo==3||combo==5){var l=ps.limitVelocityOverLifetime;l.enabled=true;l.limit=1.5f;l.dampen=0.3f;}
            if(combo==4){var s=ps.sizeOverLifetime;s.enabled=true;s.size=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.7f,1,1.3f));var r=ps.rotationOverLifetime;r.enabled=true;r.z=0.8f;}
            if(combo==6){var n=ps.noise;n.enabled=true;n.strength=0.4f;n.frequency=0.7f;n.quality=ParticleSystemNoiseQuality.High;n.octaveCount=1;n.damping=true;}
            if(combo==7){var l=ps.limitVelocityOverLifetime;l.enabled=true;l.limit=100;l.drag=0.3f;l.multiplyDragByParticleSize=true;l.multiplyDragByParticleVelocity=false;}
            ps.Simulate(0,false,true,false);
            ps.SetParticles(new[]{new ParticleSystem.Particle{position=new Vector3(0.2f,-0.1f,0.3f),velocity=new Vector3(speed*0.6f,speed*0.8f,0),startLifetime=4,remainingLifetime=4,startSize3D=new Vector3(2,3,4),rotation3D=new Vector3(10,20,30),randomSeed=(uint)(12345+index*7919),startColor=Color.white}},1);
            var samples=new List<Sample>();var particles=new ParticleSystem.Particle[1];
            for(int frame=0;frame<=12;frame++){
                if(frame>0)ps.Simulate(dt,false,false,false);ps.GetParticles(particles);var p=particles[0];
                if(frame==0||frame==1||frame==2||frame==6||frame==12)samples.Add(new Sample{frame=frame,size=p.GetCurrentSize3D(ps),rotation=p.rotation3D,velocity=p.velocity,totalVelocity=p.totalVelocity,position=p.position});
            }
            return new Case{label="speed-"+index,mode=mode,axes=axes,range=size.range,speed=speed,combo=combo,dt=dt,holdout=index%5==0,samples=samples.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run(){try{
        var rows=new List<Case>();int index=0;
        foreach(int mode in new[]{0,1,2,3})foreach(bool axes in new[]{false,true})foreach(var range in new[]{new Vector2(0,3),new Vector2(1,4),new Vector2(2,2),new Vector2(0,0),new Vector2(0.5f,0.5f),new Vector2(1,1),new Vector2(3,3),new Vector2(4,4)})foreach(float speed in new[]{0,0.5f,1,2,3,4,7})foreach(int combo in new[]{0,1,2,3,4,5,6,7}) {
            float dt=index%3==0?0.005f:index%3==1?1f/60:0.025f;rows.Add(Measure(index++,mode,axes,range,speed,combo,dt));
        }
        string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/by-speed"));Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=rows.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
