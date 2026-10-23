using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeSpriteRenderProbe {
    [Serializable] public class Sample {
        public string label;
        public int drawMode, tileMode;
        public bool flipX,flipY;
        public Vector2 size,pivot;
        public Vector4 border;
        public Color color,tint;
        public Vector2[] vertices,uv;
        public ushort[] triangles;
        public int[] pixels;
    }
    [Serializable] public class Output {public string unityVersion;public int[] texture;public Sample[] cases;}
    public static void Run() {
        QualitySettings.antiAliasing=0;
        var texture=new Texture2D(16,16,TextureFormat.RGBA32,false,true);
        texture.filterMode=FilterMode.Bilinear;texture.wrapMode=TextureWrapMode.Clamp;
        var texels=Enumerable.Range(0,256).Select(i=>new Color32((byte)((i%16)*16),(byte)((i/16)*16),(byte)128,(byte)(i%3==0?128:255))).ToArray();
        texture.SetPixels32(texels);texture.Apply();
        var go=new GameObject("Sprite render");var camGo=new GameObject("Camera");
        var renderer=go.AddComponent<SpriteRenderer>();
        var material=new Material(Shader.Find("Sprites/Default"));renderer.sharedMaterial=material;
        var camera=camGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);
        camera.allowMSAA=false;camera.orthographic=true;camera.orthographicSize=4;camera.aspect=1;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;
        var target=new RenderTexture(64,64,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);
        target.antiAliasing=1;
        var image=new Texture2D(64,64,TextureFormat.RGBA32,false,true);camera.targetTexture=target;
        var cases=new List<Sample>();
        foreach(int mode in new[]{0,1,2})foreach(int tile in mode==2?new[]{0,1}:new[]{0})
        foreach(var pivot in new[]{new Vector2(.5f,.5f),new Vector2(.25f,1.25f)})
        foreach(int flip in new[]{0,1,2,3}) {
            var border=new Vector4(2,1,3,2);
            var sprite=Sprite.Create(texture,new Rect(0,0,16,8),pivot,4,0,SpriteMeshType.FullRect,border);
            renderer.sprite=sprite;renderer.drawMode=(SpriteDrawMode)mode;renderer.size=new Vector2(5.3f,2.7f);
            renderer.tileMode=(SpriteTileMode)tile;renderer.adaptiveModeThreshold=.5f;
            renderer.flipX=(flip&1)!=0;renderer.flipY=(flip&2)!=0;
            renderer.color=new Color(.7f,.8f,.9f,.6f);material.color=new Color(.8f,.7f,.6f,.75f);
            camera.Render();RenderTexture.active=target;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();
            cases.Add(new Sample{label="sprite-"+mode+"-"+tile+"-"+pivot.y+"-"+flip,drawMode=mode,tileMode=tile,pivot=pivot,border=border,size=renderer.size,flipX=renderer.flipX,flipY=renderer.flipY,color=renderer.color,tint=material.color,vertices=sprite.vertices,uv=sprite.uv,triangles=sprite.triangles,pixels=Enumerable.Range(0,64*64).SelectMany(i=>{var p=image.GetPixel(i%64,63-i/64);return new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};}).ToArray()});
            renderer.sprite=null;UnityEngine.Object.DestroyImmediate(sprite);
        }
        File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,texture=texels.SelectMany(c=>new[]{(int)c.r,(int)c.g,(int)c.b,(int)c.a}).ToArray(),cases=cases.ToArray()},true));
        camera.targetTexture=null;RenderTexture.active=null;
        foreach(var o in new UnityEngine.Object[]{go,camGo,material,target,image,texture})UnityEngine.Object.DestroyImmediate(o);
    }
}
