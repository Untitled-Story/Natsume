using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeCanvasProbe {
    [Serializable] public class PixelSample {public Vector2 size,pivot,position,scale;public float angle;public Rect adjusted;public Vector2[] adjustedPoints;public Matrix4x4 world;}
    [Serializable] public class Sample {
        public string label; public int mode;public bool orthographic;public float plane,actualPlane;
        public Rect viewport,pixelRect;public Vector2 display,size,pivot;
        public Matrix4x4 world,view,projection;
        public Vector3[] corners;public int[] pixels;
    }
    [Serializable] public class Output {public string unityVersion;public Sample[] cases;public PixelSample[] pixelRects;}
    public static void Run() {
        var cameraObject=new GameObject("Observation");var camera=cameraObject.AddComponent<Camera>();
        var target=new RenderTexture(128,96,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.antiAliasing=1;camera.targetTexture=target;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;camera.allowMSAA=false;
        camera.transform.position=new Vector3(2,-1,-10);camera.transform.rotation=Quaternion.Euler(5,-10,3);
        camera.orthographicSize=4;camera.fieldOfView=55;camera.nearClipPlane=.1f;camera.farClipPlane=100;
        var cases=new List<Sample>();
        var read=new Texture2D(128,96,TextureFormat.RGBA32,false,true);
        foreach(int mode in new[]{0,1,2})foreach(bool ortho in new[]{false,true})
        foreach(float plane in new[]{1f,5f})foreach(bool partial in new[]{false,true}) {
            // targetTexture renders its entire surface, ignoring Camera.rect. Render the
            // requested viewport at its own pixel size, then embed it in the output display.
            var viewport=partial?new Rect(.125f,.25f,.75f,.5f):new Rect(0,0,1,1);
            int rw=partial?96:128,rh=partial?48:96;
            target.Release();target.width=rw;target.height=rh;target.Create();read.Resize(rw,rh);
            camera.rect=new Rect(0,0,1,1);camera.orthographic=ortho;
            var go=new GameObject("Canvas",typeof(RectTransform),typeof(Canvas));
            var rect=go.GetComponent<RectTransform>();rect.sizeDelta=new Vector2(160,120);
            rect.pivot=new Vector2(.25f,.75f);rect.position=new Vector3(4,5,3);
            rect.rotation=Quaternion.Euler(10,20,30);rect.localScale=new Vector3(.2f,.3f,.4f);
            var canvas=go.GetComponent<Canvas>();canvas.renderMode=(RenderMode)mode;canvas.worldCamera=camera;canvas.planeDistance=plane;
            var image=go.AddComponent<UnityEngine.UI.Image>();image.color=new Color(.8f,.4f,.2f,.6f);
            RenderTexture.active=target;GL.Viewport(new Rect(0,0,128,96));GL.Clear(true,true,Color.clear);RenderTexture.active=null;
            Canvas.ForceUpdateCanvases();camera.Render();Canvas.ForceUpdateCanvases();rect.ForceUpdateRectTransforms();
            RenderTexture.active=target;read.ReadPixels(new Rect(0,0,rw,rh),0,0);read.Apply();RenderTexture.active=null;
            int ox=Mathf.RoundToInt(viewport.x*128),oy=Mathf.RoundToInt((1-viewport.y-viewport.height)*96);
            var pixels=Enumerable.Range(0,128*96).SelectMany(i=>{int x=i%128-ox,y=i/128-oy;var p=x>=0&&x<rw&&y>=0&&y<rh?read.GetPixel(x,rh-1-y):Color.clear;return new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};}).ToArray();
            var corners=new Vector3[4];rect.GetWorldCorners(corners);
            cases.Add(new Sample{label=mode+"-"+ortho+"-"+plane+"-"+partial,mode=mode,orthographic=ortho,plane=plane,actualPlane=canvas.planeDistance,viewport=viewport,pixelRect=new Rect(viewport.x*128,viewport.y*96,rw,rh),display=new Vector2(Screen.width,Screen.height),size=rect.rect.size,pivot=rect.pivot,world=rect.localToWorldMatrix,view=camera.worldToCameraMatrix,projection=camera.projectionMatrix,corners=corners,pixels=pixels});
            UnityEngine.Object.DestroyImmediate(go);
        }
        var pixelRects=new List<PixelSample>();
        var root=new GameObject("PixelCanvas",typeof(RectTransform),typeof(Canvas));
        var pixelCanvas=root.GetComponent<Canvas>();pixelCanvas.renderMode=RenderMode.ScreenSpaceOverlay;pixelCanvas.pixelPerfect=true;
        Canvas.ForceUpdateCanvases();
        foreach(float scale in new[]{.75f,1f,1.3f})foreach(float angle in new[]{0f,20f})foreach(float offset in new[]{0f,.23f,.5f}) {
            var child=new GameObject("Image",typeof(RectTransform),typeof(UnityEngine.UI.Image));child.transform.SetParent(root.transform,false);
            var rect=child.GetComponent<RectTransform>();rect.sizeDelta=new Vector2(53.4f,27.7f);rect.pivot=new Vector2(.25f,.75f);rect.anchoredPosition=new Vector2(offset,-offset*.7f);rect.localScale=new Vector3(scale,scale,1);rect.localRotation=Quaternion.Euler(0,0,angle);
            Canvas.ForceUpdateCanvases();
            pixelRects.Add(new PixelSample{size=rect.rect.size,pivot=rect.pivot,position=rect.anchoredPosition,scale=rect.localScale,angle=angle,adjusted=RectTransformUtility.PixelAdjustRect(rect,pixelCanvas),adjustedPoints=new[]{RectTransformUtility.PixelAdjustPoint(rect.rect.min,rect,pixelCanvas),RectTransformUtility.PixelAdjustPoint(rect.rect.max,rect,pixelCanvas)},world=rect.localToWorldMatrix});
            UnityEngine.Object.DestroyImmediate(child);
        }
        UnityEngine.Object.DestroyImmediate(root);
        File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray(),pixelRects=pixelRects.ToArray()},true));
        UnityEngine.Object.DestroyImmediate(read);UnityEngine.Object.DestroyImmediate(cameraObject);UnityEngine.Object.DestroyImmediate(target);
    }
}
