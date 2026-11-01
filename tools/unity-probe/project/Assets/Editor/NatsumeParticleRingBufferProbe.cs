using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeParticleRingBufferProbe {
    [Serializable] public class Snapshot {public float delta;public int births,deathParticles;public float time;public Vector3[] positions,deathPositions;public float[] ages;public uint[] seeds;}
    [Serializable] public class Case {public bool accelerated;public int mode;public Vector2 range;public List<Snapshot> frames=new List<Snapshot>();}
    [Serializable] public class Output {public string unityVersion;public List<Case> cases=new List<Case>();}
    public static void Run(){
        var output=new Output{unityVersion=Application.unityVersion};
        foreach(bool accelerated in new[]{false,true})foreach(int mode in new[]{0,1,2})foreach(Vector2 range in new[]{new Vector2(0,1),new Vector2(0.2f,0.6f),new Vector2(0.5f,0.5f),new Vector2(0,0)}){
            var go=new GameObject("ring");
            try{
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var m=ps.main;m.playOnAwake=false;m.loop=false;m.duration=1;m.startSpeed=0;m.startLifetime=1;m.maxParticles=3;m.gravityModifier=accelerated?0.3f:0;m.ringBufferMode=(ParticleSystemRingBufferMode)mode;m.ringBufferLoopRange=range;
                var force=ps.forceOverLifetime;force.enabled=accelerated;force.x=1.5f;
                var em=ps.emission;em.enabled=false;var sh=ps.shape;sh.enabled=false;
                var child=new GameObject("death");child.transform.SetParent(go.transform);var target=child.AddComponent<ParticleSystem>();target.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var ts=target.shape;ts.enabled=false;var tm=target.main;tm.playOnAwake=false;tm.startLifetime=100;tm.startSpeed=0;var te=target.emission;te.rateOverTime=0;te.SetBursts(new[]{new ParticleSystem.Burst(0,1)});te.enabled=false;var sub=ps.subEmitters;sub.enabled=true;sub.AddSubEmitter(target,ParticleSystemSubEmitterType.Death,ParticleSystemSubEmitterProperties.InheritNothing);
                ps.Simulate(0,true,true,false);ps.Play(false);
                var c=new Case{accelerated=accelerated,mode=mode,range=range};output.cases.Add(c);uint serial=0;
                foreach(var step in new[]{new Vector2(0,3),new Vector2(0.25f,0),new Vector2(0.5f,0),new Vector2(0.5f,0),new Vector2(0,1),new Vector2(0.25f,1),new Vector2(0.5f,2),new Vector2(0.5f,0)}){
                    if(step.x>0)ps.Simulate(step.x,true,false,false);
                    for(int i=0;i<(int)step.y;i++){ps.Emit(new ParticleSystem.EmitParams{position=new Vector3(serial*10,0,0),velocity=Vector3.right,startLifetime=1,randomSeed=serial+1},1);serial++;}
                    var particles=new ParticleSystem.Particle[3];var count=ps.GetParticles(particles);var children=new ParticleSystem.Particle[100];var childCount=target.GetParticles(children);var deathPositions=new Vector3[childCount];for(int i=0;i<childCount;i++)deathPositions[i]=children[i].position;var snap=new Snapshot{delta=step.x,births=(int)step.y,time=ps.time,deathParticles=target.particleCount,deathPositions=deathPositions,positions=new Vector3[count],ages=new float[count],seeds=new uint[count]};
                    for(int i=0;i<count;i++){snap.positions[i]=particles[i].position;snap.ages[i]=particles[i].startLifetime-particles[i].remainingLifetime;snap.seeds[i]=particles[i].randomSeed;}
                    c.frames.Add(snap);
                }
            }finally{UnityEngine.Object.DestroyImmediate(go);}
        }
        var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
    }
}
