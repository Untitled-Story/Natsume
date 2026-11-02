using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEditor;
public static class NatsumeUVFlipProbe {
    [Serializable]public class Sample{public int mode,mask,count,flippedU,flippedV,flippedBoth;public float u,v;public Vector2[] uv;public Vector3[] vertices;}
    [Serializable]public class Output{public string unityVersion;public Vector2[] spriteVertices,spriteUV;public ushort[] spriteIndices;public List<Sample> cases=new List<Sample>();}
    public static void Run(){
        var view=new GameObject("Camera");var camera=view.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;
        var texture=new Texture2D(16,16);var sprite=Sprite.Create(texture,new Rect(4,4,8,8),new Vector2(.5f,.5f),8,0,SpriteMeshType.FullRect);
        var material=new Material(Shader.Find("Sprites/Default"));var output=new Output{unityVersion=Application.unityVersion,spriteVertices=sprite.vertices,spriteUV=sprite.uv,spriteIndices=sprite.triangles};
        try{
            foreach(int mode in new[]{0,1})foreach(int mask in new[]{0,1,2})foreach(float u in new[]{0f,.25f,1f})foreach(float v in new[]{0f,.75f,1f}){
            var go=new GameObject("UVFlip");try{
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;
            int count=(u==.25f||v==.75f)?8192:4;
            var main=ps.main;main.startSpeed=0;main.startLifetime=1;main.maxParticles=count;main.playOnAwake=false;
            var shape=ps.shape;shape.enabled=false;var emission=ps.emission;emission.enabled=false;
            var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.sharedMaterial=material;
            var sheet=ps.textureSheetAnimation;sheet.enabled=true;sheet.AddSprite(sprite);sheet.frameOverTime=0;sheet.numTilesX=4;sheet.numTilesY=2;
                sheet.mode=(ParticleSystemAnimationMode)mode;sheet.uvChannelMask=(UnityEngine.Rendering.UVChannelFlags)mask;
                var serialized=new SerializedObject(ps);serialized.FindProperty("UVModule.flipU").floatValue=u;serialized.FindProperty("UVModule.flipV").floatValue=v;serialized.ApplyModifiedPropertiesWithoutUndo();
                ps.Simulate(0,false,true,false);ps.Emit(count);ps.Simulate(0,false,false,false);var mesh=new Mesh();renderer.BakeMesh(mesh,camera,false);
                if(mesh.vertexCount!=count*4)throw new Exception("Expected nonempty particle quads");
                var uv=mesh.uv;int fu=0,fv=0,fb=0;
                for(int i=0;i<count;i++){bool a=uv[i*4].x>uv[i*4+1].x,b=uv[i*4].y<uv[i*4+3].y;if(a)fu++;if(b)fv++;if(a&&b)fb++;}
                output.cases.Add(new Sample{mode=mode,mask=mask,u=u,v=v,uv=uv.Take(4).ToArray(),vertices=mesh.vertices.Take(4).ToArray(),count=count,flippedU=fu,flippedV=fv,flippedBoth=fb});UnityEngine.Object.DestroyImmediate(mesh);
            }finally{UnityEngine.Object.DestroyImmediate(go);}
            }
            File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(output));
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
        finally{foreach(var o in new UnityEngine.Object[]{view,material,sprite,texture})UnityEngine.Object.DestroyImmediate(o);}
    }
}
