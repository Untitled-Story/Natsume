using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeParticleCollisionProbe
{
    [Serializable] public class Case {
        public float dampen, bounce, loss, radius, size, dt;
        public bool world;
        public Vector3 start, inputVelocity, position, velocity;
        public int count;
        public float remaining;
    }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    public static void Run() {
        var cases=new List<Case>();
        foreach(float dampen in new[]{0f,0.3f,1f}) foreach(float bounce in new[]{0f,0.6f,1f})
        foreach(float loss in new[]{0f,0.25f,1f}) foreach(float radius in new[]{0f,0.5f,1f})
        foreach(bool world in new[]{false,true}) {
            var go=new GameObject("collision-probe");var plane=new GameObject("plane");
            try {
                if(world){var box=plane.AddComponent<BoxCollider>();box.size=new Vector3(100,1,100);plane.transform.position=new Vector3(0,-0.5f,0);Physics.SyncTransforms();}
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
                var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.startLifetime=4;main.gravityModifier=0;
                main.simulationSpace=ParticleSystemSimulationSpace.World;
                var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;
                var collision=ps.collision;collision.enabled=true;collision.type=world?ParticleSystemCollisionType.World:ParticleSystemCollisionType.Planes;
                collision.dampen=dampen;collision.bounce=bounce;collision.lifetimeLoss=loss;
                collision.minKillSpeed=0;collision.maxKillSpeed=10000;collision.radiusScale=radius;
                if(!world)collision.SetPlane(0,plane.transform);
                ps.Simulate(0,false,true,false);
                var p=new Vector3(0,0.06f,0);var v=new Vector3(2,-10,1);
                ps.SetParticles(new[]{new ParticleSystem.Particle{position=p,velocity=v,startLifetime=4,remainingLifetime=3,startSize=0.2f,randomSeed=12345}},1);
                ps.Simulate(0.02f,false,false,false);
                var particles=new ParticleSystem.Particle[1];var count=ps.GetParticles(particles);
                cases.Add(new Case{dampen=dampen,bounce=bounce,loss=loss,radius=radius,size=0.2f,dt=0.02f,world=world,start=p,inputVelocity=v,count=count,position=particles[0].position,velocity=particles[0].velocity,remaining=particles[0].remainingLifetime});
            } finally {UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(plane);}
        }
        var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
    }
}
