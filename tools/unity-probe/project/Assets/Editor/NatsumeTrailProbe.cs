using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeTrailProbe
{
    [Serializable] public class Sample { public int frame,count; public Vector3[] vertices,normals,repeatVertices,freshVertices; public Vector4[] tangents; public Vector2[] uv; public Color32[] colors; public int[] indices; }
    [Serializable] public class Case { public int mode,texture,flags; public float lifetime,distance,size; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; public NatsumeTrailFoldProbe.Case[] folds; }
    static Case Measure(int mode,int texture,int flags,Camera camera) {
        var go=new GameObject("trail");var mesh=new Mesh();
        try {
            var p=go.AddComponent<ParticleSystem>();p.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);p.useAutoRandomSeed=false;p.randomSeed=12345;
            var main=p.main;main.playOnAwake=false;main.loop=false;main.startLifetime=0.5f;main.startSpeed=0;main.startSize=2;main.startColor=new Color(0.2f,0.4f,0.6f,0.8f);
            var shape=p.shape;shape.enabled=false;var em=p.emission;em.enabled=false;
            var t=p.trails;t.enabled=true;t.mode=(ParticleSystemTrailMode)mode;t.ratio=1;t.lifetime=0.4f;t.minVertexDistance=0.1f;t.textureMode=(ParticleSystemTrailTextureMode)texture;t.textureScale=new Vector2(1.5f,0.75f);
            t.sizeAffectsLifetime=(flags&1)!=0;t.sizeAffectsWidth=(flags&2)!=0;t.inheritParticleColor=(flags&4)!=0;t.dieWithParticles=(flags&8)!=0;t.worldSpace=(flags&16)!=0;t.generateLightingData=true;
            t.attachRibbonsToTransform=(flags&128)!=0;t.splitSubEmitterRibbons=(flags&256)!=0;
            if((flags&512)!=0)t.minVertexDistance=0.01f;
            t.colorOverLifetime=new ParticleSystem.MinMaxGradient(new Color(0.5f,0.6f,0.7f,0.5f));t.colorOverTrail=new ParticleSystem.MinMaxGradient(new Color(0.8f,0.6f,0.4f,0.9f));t.widthOverTrail=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.5f,1,1.5f));t.ribbonCount=2;
            var r=p.GetComponent<ParticleSystemRenderer>();r.enabled=true;r.trailMaterial=new Material(Shader.Find("Particles/Standard Unlit"));
            p.Simulate(0,false,true,false);
            var ep=new ParticleSystem.EmitParams();ep.position=Vector3.zero;ep.velocity=(flags&1024)!=0?new Vector3(1,0.5f,0.75f):new Vector3(1,0,0);p.Emit(ep,1);
            if((flags&32)!=0){t.colorOverLifetime=new ParticleSystem.MinMaxGradient(Gradient(Color.red,Color.blue));t.colorOverTrail=new ParticleSystem.MinMaxGradient(Gradient(Color.white,new Color(0.5f,1,0.5f,0.5f)));}
            if(mode==1)for(int i=1;i<5;i++){if((flags&64)!=0)p.Simulate(0.01f,false,false,false);ep.position=new Vector3(i*0.3f,(i%2)*0.2f,(flags&512)!=0?i*i*0.1f:0);p.Emit(ep,1);}
            var rows=new List<Sample>();
            for(int frame=0;frame<=16;frame++){
                if(frame>0){if(frame==4)go.transform.position=new Vector3(1,2,0);
                    if(mode==0&&(flags&512)!=0){var particles=new ParticleSystem.Particle[p.particleCount];p.GetParticles(particles);for(int i=0;i<particles.Length;i++)particles[i].velocity=frame%2==1?new Vector3(1,0,0):new Vector3(0,1,0);p.SetParticles(particles,particles.Length);}
                    p.Simulate(0.05f,false,false,false);}
                if(frame==0||frame==1||frame==2||frame==3||frame==4||frame==6||frame==9||frame==10||frame==11||frame==12||frame==16){r.BakeTrailsMesh(mesh,camera,true);var sample=new Sample{frame=frame,count=p.particleCount,vertices=mesh.vertices,normals=mesh.normals,tangents=mesh.tangents,uv=mesh.uv,colors=mesh.colors32,indices=mesh.triangles};
                    if(flags==31||flags==128||flags==512){r.BakeTrailsMesh(mesh,camera,true);sample.repeatVertices=mesh.vertices;var fresh=new Mesh();try{r.BakeTrailsMesh(fresh,camera,true);sample.freshVertices=fresh.vertices;}finally{UnityEngine.Object.DestroyImmediate(fresh);}}
                    rows.Add(sample);}
            }
            return new Case{mode=mode,texture=texture,flags=flags,lifetime=0.4f,distance=t.minVertexDistance,size=2,samples=rows.ToArray()};
        }finally{if(go.GetComponent<ParticleSystemRenderer>().trailMaterial)UnityEngine.Object.DestroyImmediate(go.GetComponent<ParticleSystemRenderer>().trailMaterial);UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(go);}
    }
    static Gradient Gradient(Color a,Color b){var g=new Gradient();g.SetKeys(new[]{new GradientColorKey(a,0),new GradientColorKey(b,1)},new[]{new GradientAlphaKey(a.a,0),new GradientAlphaKey(b.a,1)});return g;}
    public static void Run(){try{
        var cameraGo=new GameObject("camera");var camera=cameraGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;
        var rows=new List<Case>();foreach(int mode in new[]{0,1})foreach(int texture in new[]{0,1,2,3,4})foreach(int flags in new[]{0,1,2,4,8,16,31,32,64,128,256,512,1024})rows.Add(Measure(mode,texture,flags,camera));
        var folds=NatsumeTrailFoldProbe.Measure(camera);UnityEngine.Object.DestroyImmediate(cameraGo);var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=rows.ToArray(),folds=folds},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
