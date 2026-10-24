using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeTrailProbe
{
    [Serializable] public class Sample { public int frame,count; public Vector3[] vertices,normals; public Vector4[] tangents; public Vector2[] uv; public Color32[] colors; public int[] indices; }
    [Serializable] public class Case { public int mode,texture,flags; public float lifetime,distance,size; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    static Case Measure(int mode,int texture,int flags,Camera camera) {
        var go=new GameObject("trail");var mesh=new Mesh();
        try {
            var p=go.AddComponent<ParticleSystem>();p.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);p.useAutoRandomSeed=false;p.randomSeed=12345;
            var main=p.main;main.playOnAwake=false;main.loop=false;main.startLifetime=0.5f;main.startSpeed=0;main.startSize=2;main.startColor=new Color(0.2f,0.4f,0.6f,0.8f);
            var shape=p.shape;shape.enabled=false;var em=p.emission;em.enabled=false;
            var t=p.trails;t.enabled=true;t.mode=(ParticleSystemTrailMode)mode;t.ratio=1;t.lifetime=0.4f;t.minVertexDistance=0.1f;t.textureMode=(ParticleSystemTrailTextureMode)texture;t.textureScale=new Vector2(1.5f,0.75f);
            t.sizeAffectsLifetime=(flags&1)!=0;t.sizeAffectsWidth=(flags&2)!=0;t.inheritParticleColor=(flags&4)!=0;t.dieWithParticles=(flags&8)!=0;t.worldSpace=(flags&16)!=0;t.generateLightingData=true;
            t.colorOverLifetime=new ParticleSystem.MinMaxGradient(new Color(0.5f,0.6f,0.7f,0.5f));t.colorOverTrail=new ParticleSystem.MinMaxGradient(new Color(0.8f,0.6f,0.4f,0.9f));t.widthOverTrail=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.5f,1,1.5f));t.ribbonCount=2;
            var r=p.GetComponent<ParticleSystemRenderer>();r.enabled=true;r.trailMaterial=new Material(Shader.Find("Particles/Standard Unlit"));
            p.Simulate(0,false,true,false);
            var ep=new ParticleSystem.EmitParams();ep.position=Vector3.zero;ep.velocity=new Vector3(1,0,0);p.Emit(ep,1);
            if((flags&32)!=0){t.colorOverLifetime=new ParticleSystem.MinMaxGradient(Gradient(Color.red,Color.blue));t.colorOverTrail=new ParticleSystem.MinMaxGradient(Gradient(Color.white,new Color(0.5f,1,0.5f,0.5f)));}
            if(mode==1)for(int i=1;i<5;i++){if((flags&64)!=0)p.Simulate(0.01f,false,false,false);ep.position=new Vector3(i*0.3f,(i%2)*0.2f,0);p.Emit(ep,1);}
            var rows=new List<Sample>();
            for(int frame=0;frame<=16;frame++){
                if(frame>0){if(frame==4)go.transform.position=new Vector3(1,2,0);p.Simulate(0.05f,false,false,false);}
                if(frame==0||frame==1||frame==2||frame==3||frame==4||frame==6||frame==9||frame==10||frame==11||frame==12||frame==16){r.BakeTrailsMesh(mesh,camera,true);rows.Add(new Sample{frame=frame,count=p.particleCount,vertices=mesh.vertices,normals=mesh.normals,tangents=mesh.tangents,uv=mesh.uv,colors=mesh.colors32,indices=mesh.triangles});}
            }
            return new Case{mode=mode,texture=texture,flags=flags,lifetime=0.4f,distance=0.1f,size=2,samples=rows.ToArray()};
        }finally{if(go.GetComponent<ParticleSystemRenderer>().trailMaterial)UnityEngine.Object.DestroyImmediate(go.GetComponent<ParticleSystemRenderer>().trailMaterial);UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(go);}
    }
    static Gradient Gradient(Color a,Color b){var g=new Gradient();g.SetKeys(new[]{new GradientColorKey(a,0),new GradientColorKey(b,1)},new[]{new GradientAlphaKey(a.a,0),new GradientAlphaKey(b.a,1)});return g;}
    public static void Run(){try{
        var cameraGo=new GameObject("camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;
        var rows=new List<Case>();foreach(int mode in new[]{0,1})foreach(int texture in new[]{0,1,2,3,4})foreach(int flags in new[]{0,1,2,4,8,16,31,32,64})rows.Add(Measure(mode,texture,flags,camera));
        UnityEngine.Object.DestroyImmediate(cameraGo);var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=rows.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
