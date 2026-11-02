using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeCameraProbe {
    [Serializable] public class Sample {
        public bool physical,ortho,custom;public int gate;public float aspect,fov,near,far,size,focal;
        public Vector2 sensor,shift;public Vector3 position,scale;public Quaternion rotation;
        public float[] projection,view;
    }
    [Serializable] public class PixelCase {public int clear;public bool reverse,linear;public int[] pixels;}
    [Serializable] public class CanvasCase {public int mode,observer;public bool masked,enabled;public int[] pixel;}
    [Serializable] public class Output {public string unityVersion;public List<Sample> cases=new List<Sample>();public List<PixelCase> pixels=new List<PixelCase>();public List<CanvasCase> canvasPixels=new List<CanvasCase>();}
    static float[] Matrix(Matrix4x4 m){var a=new float[16];for(int i=0;i<16;i++)a[i]=m[i];return a;}
    public static void Run(){
        var go=new GameObject("Camera");var camera=go.AddComponent<Camera>();var output=new Output{unityVersion=Application.unityVersion};
        try {
            foreach(bool physical in new[]{false,true})foreach(bool ortho in new[]{false,true})
            foreach(var gate in new[]{Camera.GateFitMode.None,Camera.GateFitMode.Vertical,Camera.GateFitMode.Horizontal,Camera.GateFitMode.Fill,Camera.GateFitMode.Overscan})
            foreach(float aspect in new[]{.5f,1f,1.5f,2.4f})foreach(bool shifted in new[]{false,true})foreach(bool scaled in new[]{false,true}){
                camera.usePhysicalProperties=physical;camera.orthographic=ortho;camera.aspect=aspect;
                camera.fieldOfView=55;camera.orthographicSize=3.7f;camera.nearClipPlane=.17f;camera.farClipPlane=234;
                camera.sensorSize=new Vector2(36,24);camera.focalLength=43;camera.lensShift=shifted?new Vector2(.17f,-.23f):Vector2.zero;camera.gateFit=gate;
                camera.transform.position=new Vector3(2,-3,-7);camera.transform.rotation=Quaternion.Euler(17,-23,11);camera.transform.localScale=scaled?new Vector3(-2,.3f,4):Vector3.one;
                output.cases.Add(new Sample{physical=physical,ortho=ortho,gate=(int)gate,aspect=camera.aspect,fov=camera.fieldOfView*Mathf.Deg2Rad,near=camera.nearClipPlane,far=camera.farClipPlane,size=camera.orthographicSize,focal=camera.focalLength,sensor=camera.sensorSize,shift=camera.lensShift,position=camera.transform.position,rotation=camera.transform.rotation,scale=camera.transform.localScale,projection=Matrix(camera.projectionMatrix),view=Matrix(camera.worldToCameraMatrix)});
            }
            foreach(float skew in new[]{-.23f,0f,.41f}){
                var projection=Matrix4x4.Perspective(63,1.7f,.2f,173);projection[0,1]=skew;projection[0,2]=.13f;projection[1,2]=-.27f;
                camera.projectionMatrix=projection;
                output.cases.Add(new Sample{custom=true,projection=Matrix(camera.projectionMatrix),view=Matrix(camera.worldToCameraMatrix),position=camera.transform.position,rotation=camera.transform.rotation,scale=camera.transform.localScale});
            }
            Pixels(output);
            CanvasPixels(output);
            File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(output));
        }catch(Exception e){Debug.LogException(e);UnityEditor.EditorApplication.Exit(1);}
        finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    static void CanvasPixels(Output output){
        var target=new RenderTexture(64,48,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.Create();
        var root=new GameObject("CameraCanvasPixels");var canvasGo=new GameObject("Canvas",typeof(RectTransform),typeof(Canvas));canvasGo.transform.parent=root.transform;
        var image=canvasGo.AddComponent<UnityEngine.UI.Image>();image.color=new Color(1,1,0,1);
        var canvas=canvasGo.GetComponent<Canvas>();canvas.planeDistance=1;
        var read=new Texture2D(1,1,TextureFormat.RGBA32,false,true);var previous=RenderTexture.active;
        var cameras=new List<Camera>();
        try{
            for(int i=0;i<2;i++){
                var go=new GameObject("Camera");go.transform.parent=root.transform;go.transform.position=new Vector3(0,0,-5);
                var c=go.AddComponent<Camera>();c.enabled=false;c.targetTexture=target;c.orthographic=true;c.orthographicSize=2;c.nearClipPlane=.1f;c.farClipPlane=100;c.clearFlags=CameraClearFlags.SolidColor;c.backgroundColor=Color.clear;c.allowHDR=false;c.allowMSAA=false;cameras.Add(c);
            }
            canvas.worldCamera=cameras[0];
            foreach(int mode in new[]{1,2})foreach(bool masked in new[]{false,true})foreach(bool enabled in new[]{false,true})foreach(int observer in new[]{0,1}){
                canvas.renderMode=(RenderMode)mode;cameras[0].enabled=enabled;
                cameras[0].cullingMask=cameras[1].cullingMask=masked?0:~0;
                Canvas.ForceUpdateCanvases();cameras[observer].Render();
                RenderTexture.active=target;read.ReadPixels(new Rect(32,24,1,1),0,0);read.Apply();var p=read.GetPixels32()[0];
                output.canvasPixels.Add(new CanvasCase{mode=mode,masked=masked,enabled=enabled,observer=observer,pixel=new[]{(int)p.r,(int)p.g,(int)p.b,(int)p.a}});
            }
        }finally{RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(read);}
    }
    static void Pixels(Output output){
        var root=new GameObject("CameraPixels");var target=new RenderTexture(64,48,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.antiAliasing=1;target.Create();
        var read=new Texture2D(64,48,TextureFormat.RGBA32,false,true);var skybox=RenderSettings.skybox;RenderSettings.skybox=null;
        var previous=RenderTexture.active;var mesh=new Mesh();mesh.vertices=new[]{new Vector3(-1,-1,0),new Vector3(1,-1,0),new Vector3(1,1,0),new Vector3(-1,1,0)};mesh.triangles=new[]{0,1,2,0,2,3};
        var materials=new List<Material>();var originalColorSpace=UnityEditor.PlayerSettings.colorSpace;
        try{
            var cameras=new List<Camera>();
            for(int i=0;i<2;i++){
                var objectGo=new GameObject("Quad");objectGo.transform.parent=root.transform;objectGo.layer=i;objectGo.transform.position=new Vector3(0,0,i);
                objectGo.AddComponent<MeshFilter>().sharedMesh=mesh;
                var material=new Material(Shader.Find("Hidden/NatsumeCameraColor"));material.SetColor("_Color",i==0?Color.red:Color.blue);materials.Add(material);objectGo.AddComponent<MeshRenderer>().sharedMaterial=material;
                var cgo=new GameObject("View");cgo.transform.parent=root.transform;cgo.transform.position=new Vector3(0,0,-5);
                var c=cgo.AddComponent<Camera>();c.enabled=false;c.targetTexture=target;c.orthographic=true;c.orthographicSize=2;c.aspect=64f/48;c.nearClipPlane=.1f;c.farClipPlane=100;c.cullingMask=1<<i;c.allowMSAA=false;c.allowHDR=false;c.backgroundColor=new Color(0,i==0?1:.5f,0,1);cameras.Add(c);
            }
            foreach(bool linear in new[]{false,true})foreach(int clear in new[]{0,1,2,3})foreach(bool reverse in new[]{false,true}){
                UnityEditor.PlayerSettings.colorSpace=linear?ColorSpace.Linear:ColorSpace.Gamma;
                if(QualitySettings.activeColorSpace!=(linear?ColorSpace.Linear:ColorSpace.Gamma))throw new Exception("Camera color space did not switch");
                RenderTexture.active=target;GL.Clear(true,true,Color.clear);
                cameras[0].clearFlags=CameraClearFlags.SolidColor;cameras[1].clearFlags=new[]{CameraClearFlags.Skybox,CameraClearFlags.SolidColor,CameraClearFlags.Depth,CameraClearFlags.Nothing}[clear];
                cameras[reverse?1:0].Render();cameras[reverse?0:1].Render();RenderTexture.active=target;
                read.ReadPixels(new Rect(0,0,64,48),0,0);read.Apply();var colors=read.GetPixels32();var bytes=new int[64*48*4];
                for(int y=0;y<48;y++)for(int x=0;x<64;x++){var p=colors[(47-y)*64+x];int k=(y*64+x)*4;bytes[k]=p.r;bytes[k+1]=p.g;bytes[k+2]=p.b;bytes[k+3]=p.a;}
                output.pixels.Add(new PixelCase{clear=clear,reverse=reverse,linear=linear,pixels=bytes});
            }
        }finally{UnityEditor.PlayerSettings.colorSpace=originalColorSpace;RenderTexture.active=previous;RenderSettings.skybox=skybox;UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(read);UnityEngine.Object.DestroyImmediate(mesh);foreach(var m in materials)UnityEngine.Object.DestroyImmediate(m);}
    }
}
