using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeShapeTextureProbe {
    [Serializable] public class Sample {public Vector3 position; public Color color;}
    [Serializable] public class Case {public int geometry,channel,uvChannel,count,requestedCount;public float threshold;public bool bilinear,color,alpha;public List<Sample> samples=new List<Sample>();}
    [Serializable] public class Output {public string unityVersion; public string pngBase64;public Vector3[] vertices;public Vector2[] uv;public Color32[] pixels;public List<Case> cases=new List<Case>();}
    public static void Run(){
        var texture=new Texture2D(2,2,TextureFormat.RGBA32,false);var mesh=new Mesh();
        try{
            var pixels=new[]{new Color32(255,64,128,0),new Color32(32,255,96,85),new Color32(64,128,255,170),new Color32(192,16,32,255)};texture.SetPixels32(pixels);texture.Apply();texture.wrapMode=TextureWrapMode.Repeat;
            var vertices=new List<Vector3>();var uvs=new List<Vector2>();var normals=new List<Vector3>();var indices=new List<int>();
            foreach(float v in new[]{-0.1f,0f,0.125f,0.25f,0.5f,0.75f,0.875f,1f,1.1f})foreach(float u in new[]{0f,0.25f,0.5f,0.75f,1f}){vertices.Add(new Vector3(u,v,0));uvs.Add(new Vector2(u,v));normals.Add(Vector3.forward);}
            for(int i=0;i<vertices.Count;i++)indices.AddRange(new[]{i,i,i});mesh.SetVertices(vertices);mesh.SetNormals(normals);mesh.SetUVs(0,uvs);var mirrored=new List<Vector2>();foreach(var uv in uvs)mirrored.Add(new Vector2(1-uv.x,1-uv.y));mesh.SetUVs(1,mirrored);mesh.SetTriangles(indices,0);
            var output=new Output{unityVersion=Application.unityVersion,pngBase64=Convert.ToBase64String(texture.EncodeToPNG()),vertices=mesh.vertices,uv=mesh.uv,pixels=pixels};
            foreach(int geometry in new[]{0,1,2,3,4,5,6,7})foreach(int uvChannel in geometry==0?new[]{0,1,2,3}:new[]{0})foreach(int channel in new[]{0,1,2,3})foreach(float threshold in new[]{0f,0.25f,0.5f,1f})foreach(bool bilinear in new[]{false,true})foreach(int influence in new[]{0,1,2,3})foreach(int requestedCount in geometry==0&&uvChannel==0&&channel==3&&threshold==0&&!bilinear&&influence==2?new[]{1,2,3,4,5,7,8,15,16,17,44,45,46,47,48,49}:new[]{geometry==0?45:256}){
                var go=new GameObject("texture-shape");try{
                    var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
                    var main=ps.main;main.playOnAwake=false;main.startLifetime=10;main.startSpeed=0;main.maxParticles=1024;main.startColor=new Color(0.8f,0.6f,0.4f,0.75f);
                    var emission=ps.emission;emission.enabled=false;var shape=ps.shape;
                    shape.shapeType=new[]{ParticleSystemShapeType.Mesh,ParticleSystemShapeType.Rectangle,ParticleSystemShapeType.Circle,ParticleSystemShapeType.Sphere,ParticleSystemShapeType.Box,ParticleSystemShapeType.Cone,ParticleSystemShapeType.SingleSidedEdge,ParticleSystemShapeType.Donut}[geometry];shape.donutRadius=0.25f;
                    if(geometry==0){shape.mesh=mesh;shape.meshShapeType=ParticleSystemMeshShapeType.Vertex;shape.meshSpawnMode=ParticleSystemShapeMultiModeValue.Loop;}
                    shape.radius=1;shape.textureUVChannel=uvChannel;shape.texture=texture;shape.textureClipChannel=(ParticleSystemShapeTextureChannel)channel;shape.textureClipThreshold=threshold;shape.textureColorAffectsParticles=(influence&1)!=0;shape.textureAlphaAffectsParticles=(influence&2)!=0;shape.textureBilinearFiltering=bilinear;
                    ps.Simulate(0,false,true,false);ps.Emit(requestedCount);var particles=new ParticleSystem.Particle[1024];int count=ps.GetParticles(particles);
                    var c=new Case{geometry=geometry,uvChannel=uvChannel,channel=channel,threshold=threshold,bilinear=bilinear,color=(influence&1)!=0,alpha=(influence&2)!=0,count=count,requestedCount=requestedCount};for(int i=0;i<count;i++)c.samples.Add(new Sample{position=particles[i].position,color=particles[i].startColor});output.cases.Add(c);
                }finally{UnityEngine.Object.DestroyImmediate(go);}
            }
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output));
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}finally{UnityEngine.Object.DestroyImmediate(texture);UnityEngine.Object.DestroyImmediate(mesh);}
    }
}
