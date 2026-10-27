using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/** Isolates inheritance from hierarchy transforms and simulation-space conversions. */
public static class NatsumeSubEmitterTransformProbe
{
    [Serializable] public sealed class TransformData { public Vector3 position, scale; public Quaternion rotation; }
    [Serializable] public sealed class Particle { public Vector3 position, velocity, size, rotation; public float lifetime, remaining; }
    [Serializable] public sealed class Case
    {
        public int space, scaling, inherit;
        public bool nonUniform;
        public TransformData root, parent, target, custom;
        public Particle source;
        public Particle[] initial, advanced;
    }
    [Serializable] public sealed class Output { public string unityVersion; public List<Case> cases = new List<Case>(); }
    static TransformData ReadTransform(Transform t) => new TransformData { position=t.localPosition, rotation=t.localRotation, scale=t.localScale };
    static GameObject Node(string name, Transform parent, Vector3 position, Vector3 rotation, Vector3 scale)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.transform.localPosition=position;
        go.transform.localRotation=Quaternion.Euler(rotation);
        go.transform.localScale=scale;
        return go;
    }
    static Particle[] Read(ParticleSystem ps)
    {
        var particles=new ParticleSystem.Particle[ps.particleCount]; ps.GetParticles(particles);
        var rows=new Particle[particles.Length];
        for(int i=0;i<rows.Length;i++) {var p=particles[i]; rows[i]=new Particle {position=p.position,velocity=p.totalVelocity,size=p.GetCurrentSize3D(ps),rotation=p.rotation3D*Mathf.Deg2Rad,lifetime=p.startLifetime,remaining=p.remainingLifetime};}
        return rows;
    }
    static ParticleSystem Make(GameObject go, bool parent, int space, int scaling, Transform custom)
    {
        var ps=go.AddComponent<ParticleSystem>(); ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
        ps.useAutoRandomSeed=false;ps.randomSeed=12345;
        var m=ps.main;m.playOnAwake=false;m.loop=false;m.duration=2;m.startSpeed=0;m.startLifetime=parent?.55f:.9f;
        m.startSize3D=true;m.startSizeX=parent?1.1f:.8f;m.startSizeY=parent?1.7f:.5f;m.startSizeZ=parent?.6f:1.2f;
        m.startRotation3D=true;m.startRotationX=parent?.2f:-.1f;m.startRotationY=parent?-.1f:.4f;m.startRotationZ=parent?.3f:-.2f;
        m.simulationSpace=(ParticleSystemSimulationSpace)space;m.customSimulationSpace=custom;m.scalingMode=(ParticleSystemScalingMode)scaling;
        var shape=ps.shape;shape.enabled=false;var e=ps.emission;e.enabled=false;e.rateOverTime=0;e.SetBursts(parent?new ParticleSystem.Burst[0]:new[]{new ParticleSystem.Burst(0,2)});
        ps.GetComponent<ParticleSystemRenderer>().enabled=false;
        return ps;
    }
    public static void Run()
    {
        try {
            var output=new Output {unityVersion=Application.unityVersion};
            foreach(bool nonUniform in new[]{false,true}) foreach(int scaling in new[]{0,1,2}) foreach(int space in new[]{0,1,2}) foreach(int inherit in new[]{0,2,4,8,31}) {
                var root=Node("root",null,new Vector3(3,4,5),new Vector3(13,-17,23),nonUniform?new Vector3(2,.75f,1.4f):Vector3.one);
                try {
                    var parent=Node("parent",root.transform,new Vector3(1,.2f,-.5f),new Vector3(-11,31,7),nonUniform?new Vector3(.6f,1.8f,1.1f):Vector3.one);
                    var target=Node("target",parent.transform,new Vector3(2,-1,.3f),new Vector3(19,47,-29),nonUniform?new Vector3(1.2f,.8f,1.6f):Vector3.one);
                    var custom=Node("custom",root.transform,new Vector3(-3,2,1),new Vector3(-9,5,21),nonUniform?new Vector3(.9f,1.3f,.7f):Vector3.one);
                    var p=Make(parent,true,0,scaling,custom.transform);var c=Make(target,false,space,scaling,custom.transform);
                    var sub=p.subEmitters;sub.enabled=true;sub.AddSubEmitter(c,ParticleSystemSubEmitterType.Manual,(ParticleSystemSubEmitterProperties)inherit);
                    p.Simulate(0,true,true,false);
                    var ep=new ParticleSystem.EmitParams {position=new Vector3(.2f,.3f,.4f),velocity=new Vector3(1,2,3)};p.Emit(ep,1);
                    var row=new Case {space=space,scaling=scaling,inherit=inherit,nonUniform=nonUniform,root=ReadTransform(root.transform),parent=ReadTransform(parent.transform),target=ReadTransform(target.transform),custom=ReadTransform(custom.transform),source=Read(p)[0]};
                    p.TriggerSubEmitter(0);row.initial=Read(c);p.Simulate(1f/60,true,false,false);row.advanced=Read(c);output.cases.Add(row);
                } finally {UnityEngine.Object.DestroyImmediate(root);}
            }
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
        } catch(Exception error) {Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
