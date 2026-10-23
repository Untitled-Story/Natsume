using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEditor;

public static class NatsumeImageProbe {
    [Serializable] public class LargeSample {public Vector2 size;public bool center;public int vertices;public float[] xs,ys;}
    [Serializable] public class Sample {
        public string label;public int type,method,origin;public bool clockwise,aspect,center,sourceMesh;
        public float amount,multiplier;public Vector2 size,pivot;public Color color;
        public Vector3[] vertices;public Vector2[] uv;public int[] triangles,pixels;
    }
    [Serializable] public class Output {
        public string unityVersion;public Sample[] cases;public Sample[] meshCases;public LargeSample[] largeCases;public Vector2[] meshVertices,meshUV;public ushort[] meshTriangles;public Vector4 meshPadding,meshRect,meshTextureRect;public Vector2 meshPivot,meshOffset;
        public Vector2[] vertices,uv;public ushort[] triangles;public int[] texture;
    }
    public static void Run() {
        QualitySettings.antiAliasing=0;
        var texture=new Texture2D(16,16,TextureFormat.RGBA32,false,true);texture.filterMode=FilterMode.Bilinear;texture.wrapMode=TextureWrapMode.Clamp;
        texture.SetPixels(Enumerable.Range(0,256).Select(i=>new Color((i%16)/15f,(i/16)/15f,.5f,.2f+.6f*(i%5)/4f)).ToArray());texture.Apply();
        var sprite=Sprite.Create(texture,new Rect(0,0,16,8),new Vector2(.25f,1.25f),100,0,SpriteMeshType.FullRect,new Vector4(2,1,3,2));
        var go=new GameObject("Canvas",typeof(RectTransform),typeof(Canvas));var canvas=go.GetComponent<Canvas>();canvas.renderMode=RenderMode.WorldSpace;go.GetComponent<RectTransform>().sizeDelta=new Vector2(128,96);
        var imageObject=new GameObject("Image",typeof(RectTransform),typeof(CanvasRenderer),typeof(Image));imageObject.transform.SetParent(go.transform,false);
        var image=imageObject.GetComponent<Image>();image.sprite=sprite;image.color=new Color(.7f,.8f,.9f,.6f);
        var rect=imageObject.GetComponent<RectTransform>();rect.pivot=new Vector2(.25f,.75f);rect.sizeDelta=new Vector2(53,27);
        var cameraObject=new GameObject("Camera");var camera=cameraObject.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=48;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;camera.allowMSAA=false;camera.nearClipPlane=.1f;camera.farClipPlane=100;
        var target=new RenderTexture(128,96,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.antiAliasing=1;camera.targetTexture=target;
        var pixels=new Texture2D(128,96,TextureFormat.RGBA32,false,true);
        var cases=new List<Sample>();
        Action<Sample> capture=c=>{
            image.type=(Image.Type)c.type;image.preserveAspect=c.aspect;image.fillCenter=c.center;image.useSpriteMesh=c.sourceMesh;
            image.fillMethod=(Image.FillMethod)c.method;image.fillOrigin=c.origin;image.fillClockwise=c.clockwise;image.fillAmount=c.amount;image.pixelsPerUnitMultiplier=c.multiplier;
            Canvas.ForceUpdateCanvases();camera.Render();
            using(var helper=new VertexHelper()) {
                typeof(Image).GetMethod("OnPopulateMesh",BindingFlags.NonPublic|BindingFlags.Instance,null,new[]{typeof(VertexHelper)},null).Invoke(image,new object[]{helper});
                var mesh=new Mesh();helper.FillMesh(mesh);c.vertices=mesh.vertices;c.uv=mesh.uv;c.triangles=mesh.triangles;UnityEngine.Object.DestroyImmediate(mesh);
            }
            RenderTexture.active=target;pixels.ReadPixels(new Rect(0,0,128,96),0,0);pixels.Apply();RenderTexture.active=null;
            c.pixels=Enumerable.Range(0,128*96).SelectMany(i=>{var p=pixels.GetPixel(i%128,95-i/128);return new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};}).ToArray();
            c.size=rect.rect.size;c.pivot=rect.pivot;c.color=image.color;cases.Add(c);
        };
        foreach(int type in new[]{0,1,2})foreach(bool aspect in new[]{false,true})foreach(bool center in new[]{false,true})foreach(bool sourceMesh in type==0?new[]{false,true}:new[]{false})
            capture(new Sample{label=type+"-"+aspect+"-"+center+"-"+sourceMesh,type=type,aspect=aspect,center=center,sourceMesh=sourceMesh,amount=1,multiplier=1});
        foreach(int method in new[]{0,1,2,3,4})foreach(int origin in Enumerable.Range(0,method<2?2:4))
        foreach(bool clockwise in new[]{false,true})foreach(float amount in new[]{0f,.2f,.5f,.8f,1f})
            capture(new Sample{label="fill-"+method+"-"+origin+"-"+clockwise+"-"+amount,type=3,method=method,origin=origin,clockwise=clockwise,amount=amount,center=true,multiplier=1});
        var tightTexture=new Texture2D(64,64,TextureFormat.RGBA32,false,true);
        tightTexture.SetPixels(Enumerable.Range(0,4096).Select(i=>i%64>=8&&i%64<56&&i/64>=16&&i/64<48?Color.white:Color.clear).ToArray());tightTexture.Apply();
        Directory.CreateDirectory("Assets/UIImageProbe");File.WriteAllBytes("Assets/UIImageProbe/tight.png",tightTexture.EncodeToPNG());AssetDatabase.ImportAsset("Assets/UIImageProbe/tight.png",ImportAssetOptions.ForceSynchronousImport);
        var importer=(TextureImporter)AssetImporter.GetAtPath("Assets/UIImageProbe/tight.png");importer.textureType=TextureImporterType.Sprite;importer.spriteImportMode=SpriteImportMode.Single;importer.spritePixelsPerUnit=100;importer.isReadable=true;importer.textureCompression=TextureImporterCompression.Uncompressed;
        var settings=new TextureImporterSettings();importer.ReadTextureSettings(settings);settings.spriteBorder=new Vector4(12,20,12,20);settings.spriteMeshType=SpriteMeshType.Tight;settings.spriteAlignment=(int)SpriteAlignment.Custom;settings.spritePivot=new Vector2(.25f,.75f);importer.SetTextureSettings(settings);importer.SaveAndReimport();
        var tight=AssetDatabase.LoadAssetAtPath<Sprite>("Assets/UIImageProbe/tight.png");
        var meshCases=new List<Sample>();image.sprite=tight;
        foreach(int type in new[]{0,1,2})foreach(bool useMesh in type==0?new[]{false,true}:new[]{false})foreach(bool aspect in new[]{false,true}){
            capture(new Sample{label="mesh-"+type+"-"+useMesh+"-"+aspect,type=type,center=true,sourceMesh=useMesh,aspect=aspect,amount=1,multiplier=1});
            meshCases.Add(cases[cases.Count-1]);cases.RemoveAt(cases.Count-1);
        }
        image.sprite=sprite;
        var largeCases=new List<LargeSample>();
        image.type=Image.Type.Tiled;image.pixelsPerUnitMultiplier=1;
        foreach(var size in new[]{new Vector2(1000,1000),new Vector2(2000,1000),new Vector2(1000,2000),new Vector2(10000,10000),new Vector2(100000,100000),new Vector2(200000,100000)})foreach(bool center in new[]{false,true}) {
            rect.sizeDelta=size;image.fillCenter=center;Canvas.ForceUpdateCanvases();
            using(var helper=new VertexHelper()){
                typeof(Image).GetMethod("OnPopulateMesh",BindingFlags.NonPublic|BindingFlags.Instance,null,new[]{typeof(VertexHelper)},null).Invoke(image,new object[]{helper});
                var mesh=new Mesh();helper.FillMesh(mesh);var vertices=mesh.vertices;
                largeCases.Add(new LargeSample{size=size,center=center,vertices=vertices.Length,xs=vertices.Select(v=>v.x).Distinct().OrderBy(v=>v).Take(12).ToArray(),ys=vertices.Select(v=>v.y).Distinct().OrderBy(v=>v).Take(12).ToArray()});UnityEngine.Object.DestroyImmediate(mesh);
            }
        }
        var colors=texture.GetPixels().SelectMany(p=>new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)}).ToArray();
        File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray(),largeCases=largeCases.ToArray(),meshCases=meshCases.ToArray(),meshVertices=tight.vertices,meshUV=tight.uv,meshTriangles=tight.triangles,meshPadding=UnityEngine.Sprites.DataUtility.GetPadding(tight),meshRect=new Vector4(tight.rect.x,tight.rect.y,tight.rect.width,tight.rect.height),meshTextureRect=new Vector4(tight.textureRect.x,tight.textureRect.y,tight.textureRect.width,tight.textureRect.height),meshOffset=tight.textureRectOffset,meshPivot=tight.pivot/tight.rect.size,vertices=sprite.vertices,uv=sprite.uv,triangles=sprite.triangles,texture=colors},true));
        foreach(var o in new UnityEngine.Object[]{go,cameraObject,target,pixels,sprite,texture,tightTexture})UnityEngine.Object.DestroyImmediate(o);
    }
}
