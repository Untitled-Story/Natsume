using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeExternalForcesProbe
{
    [Serializable] public class Case {
        public int filter, mask, list, disabled;
        public bool local, curve;
        public float dt, multiplier;
        public Vector3 position, velocity;
    }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    public static void Run() {
        var cases = new List<Case>();
        for(int filter=0;filter<3;filter++) for(int mask=0;mask<4;mask++)
        for(int list=0;list<4;list++) for(int disabled=0;disabled<2;disabled++)
        foreach(bool local in new[]{false,true}) foreach(bool curve in new[]{false,true}) {
            var objects = new List<GameObject>();
            try {
                var fields = new ParticleSystemForceField[2];
                for(int i=0;i<2;i++) {
                    var fieldObject=new GameObject("field");objects.Add(fieldObject);
                    fieldObject.layer=i+8;
                    fields[i]=fieldObject.AddComponent<ParticleSystemForceField>();
                    fields[i].shape=ParticleSystemForceFieldShape.Sphere;
                    fields[i].startRange=0;fields[i].endRange=100;
                    fields[i].directionX=i==0?2:0;fields[i].directionY=i==1?3:0;
                    fields[i].directionZ=0;fields[i].enabled=disabled==0||i!=0;
                }
                var go=new GameObject("external-force");objects.Add(go);
                go.transform.rotation=local?Quaternion.Euler(0,0,90):Quaternion.identity;
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var main=ps.main;main.playOnAwake=false;main.startLifetime=4;main.startSpeed=0;main.gravityModifier=0;
                main.simulationSpace=local?ParticleSystemSimulationSpace.Local:ParticleSystemSimulationSpace.World;
                var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;
                var ext=ps.externalForces;ext.enabled=true;ext.influenceFilter=(ParticleSystemGameObjectFilter)filter;
                ext.influenceMask=((mask&1)!=0?1<<8:0)|((mask&2)!=0?1<<9:0);
                for(int i=0;i<2;i++)if((list&(1<<i))!=0)ext.AddInfluence(fields[i]);
                if(curve) {
                    var c=AnimationCurve.Linear(0,0.5f,1,2.5f);
                    var p=new ParticleSystem.MinMaxCurve(1,c,c);p.mode=ParticleSystemCurveMode.Curve;
                    ext.multiplierCurve=p;
                } else ext.multiplier=1.5f;
                ps.Simulate(0,false,true,false);
                ps.SetParticles(new[]{new ParticleSystem.Particle{position=Vector3.zero,velocity=Vector3.zero,startLifetime=4,remainingLifetime=3,startSize=1,randomSeed=12345}},1);
                ps.Simulate(0.02f,false,false,false);
                var particles=new ParticleSystem.Particle[1];ps.GetParticles(particles);
                cases.Add(new Case{filter=filter,mask=mask,list=list,disabled=disabled,local=local,curve=curve,dt=0.02f,multiplier=curve?1:1.5f,position=particles[0].position,velocity=particles[0].velocity});
            } finally { foreach(var go in objects)UnityEngine.Object.DestroyImmediate(go); }
        }
        var output=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        File.WriteAllText(output,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
    }
}
