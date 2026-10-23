using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeSpriteSheetProbe {
    [Serializable] public class Sample {public string label;public float age;public float remaining;public float time;public string timeMode;public float frame;public int count;public Vector3[] vertices;public Vector2[] uv;public int[] triangles;}
    [Serializable] public class Output {public string unityVersion;public Sample[] cases;}
    public static void Run() {
        var texture=new Texture2D(16,16);texture.SetPixels(Enumerable.Repeat(Color.white,256).ToArray());texture.Apply();
        var other=new Texture2D(8,8);other.SetPixels(Enumerable.Repeat(Color.white,64).ToArray());other.Apply();
        var sprites=new[]{Sprite.Create(texture,new Rect(0,0,16,8),new Vector2(.25f,1.25f),4,0,SpriteMeshType.FullRect),Sprite.Create(texture,new Rect(8,8,8,8),new Vector2(.5f,.5f),4,0,SpriteMeshType.FullRect)};
        var go=new GameObject("Sheet");var cameraObject=new GameObject("Camera");var camera=cameraObject.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;
        var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
        var main=ps.main;main.startLifetime=1;main.startSpeed=0;main.startSize=1;main.maxParticles=1;main.playOnAwake=false;
        var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;
        var sheet=ps.textureSheetAnimation;sheet.enabled=true;sheet.mode=ParticleSystemAnimationMode.Sprites;foreach(var s in sprites)sheet.AddSprite(s);
        sheet.frameOverTime=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0,1,1));sheet.startFrame=0;sheet.cycleCount=1;sheet.uvChannelMask=UnityEngine.Rendering.UVChannelFlags.UV0;
        var renderer=go.GetComponent<ParticleSystemRenderer>();renderer.alignment=ParticleSystemRenderSpace.View;
        var material=new Material(Shader.Find("Sprites/Default"));renderer.sharedMaterial=material;
        var cases=new List<Sample>();
        foreach(float age in new[]{0f,.25f,.499f,.5f,.501f,.75f,.999f}) {
            ps.Simulate(0,false,true,false);ps.Emit(1);var particles=new ParticleSystem.Particle[1];ps.GetParticles(particles);particles[0].position=Vector3.zero;particles[0].startLifetime=1;particles[0].remainingLifetime=1;particles[0].startSize=1;particles[0].rotation3D=Vector3.zero;ps.SetParticles(particles,1);ps.Simulate(age,false,false,false);
            var mesh=new Mesh();renderer.BakeMesh(mesh,camera,false);
            cases.Add(new Sample{label="sheet-"+age,age=age,remaining=ps.GetParticles(particles)>0?particles[0].remainingLifetime:-1,time=ps.time,timeMode=sheet.timeMode.ToString(),frame=sheet.frameOverTime.Evaluate(age),count=sheet.spriteCount,vertices=mesh.vertices,uv=mesh.uv,triangles=mesh.triangles});UnityEngine.Object.DestroyImmediate(mesh);
        }
        File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
        foreach(var o in new UnityEngine.Object[]{go,cameraObject,material,sprites[0],sprites[1],texture,other})UnityEngine.Object.DestroyImmediate(o);
    }
}
