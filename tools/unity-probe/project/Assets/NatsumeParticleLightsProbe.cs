#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class NatsumeParticleLightsProbe : MonoBehaviour
{
    [Serializable] public class Case { public bool curve;public float phase,range,intensity;public int switches,nativeMax,referenceMax,multiplyError,replaceError; }
    [Serializable] public class Output { public string unityVersion;public List<Case> cases=new List<Case>(); }
    readonly Output output=new Output();
    ParticleSystem particles;Light template,reference;Camera camera;RenderTexture target;
    Color32[] native;int index,frame;Case current;
    readonly Color sourceColor=new Color(0.25f,0.5f,0.75f,0.5f),templateColor=new Color(0.4f,0.6f,0.8f);
    public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("particle-lights").AddComponent<NatsumeParticleLightsProbe>();EditorApplication.EnterPlaymode();}
    void Start(){
        Time.captureFramerate=60;output.unityVersion=Application.unityVersion;
        RenderSettings.ambientMode=AmbientMode.Flat;RenderSettings.ambientLight=Color.black;RenderSettings.fog=false;QualitySettings.pixelLightCount=8;
        var quad=GameObject.CreatePrimitive(PrimitiveType.Quad);quad.transform.localScale=new Vector3(4,4,1);
        quad.GetComponent<MeshRenderer>().sharedMaterial=new Material(Shader.Find("Legacy Shaders/Diffuse")){color=Color.white};
        camera=new GameObject("camera").AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-4);camera.orthographic=true;camera.orthographicSize=2;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.nearClipPlane=0.01f;camera.farClipPlane=20;camera.enabled=false;
        target=new RenderTexture(32,32,24,RenderTextureFormat.ARGB32);target.Create();camera.targetTexture=target;
        template=new GameObject("template").AddComponent<Light>();template.type=LightType.Point;template.renderMode=LightRenderMode.ForcePixel;template.range=3;template.intensity=2;template.color=templateColor;template.transform.position=new Vector3(1000,0,-1);template.shadows=LightShadows.None;
        reference=new GameObject("reference").AddComponent<Light>();reference.type=LightType.Point;reference.renderMode=LightRenderMode.ForcePixel;reference.transform.position=new Vector3(0,0,-1);reference.shadows=LightShadows.None;reference.enabled=false;
        particles=new GameObject("particles").AddComponent<ParticleSystem>();particles.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
        var m=particles.main;m.playOnAwake=false;m.loop=false;m.startLifetime=100;m.startSpeed=0;m.startSize=2;m.startColor=sourceColor;m.simulationSpace=ParticleSystemSimulationSpace.World;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
        var em=particles.emission;em.enabled=false;var sh=particles.shape;sh.enabled=false;particles.GetComponent<ParticleSystemRenderer>().renderMode=ParticleSystemRenderMode.None;
        var l=particles.lights;l.enabled=true;l.light=template;l.ratio=1;l.maxLights=1;l.range=0.7f;l.intensity=0.6f;
        particles.Play(false);particles.Emit(new ParticleSystem.EmitParams{position=new Vector3(0,0,-1)},1);
    }
    Color32[] Read(){camera.Render();var old=RenderTexture.active;RenderTexture.active=target;var image=new Texture2D(32,32,TextureFormat.RGBA32,false);image.ReadPixels(new Rect(0,0,32,32),0,0);image.Apply();var pixels=image.GetPixels32();UnityEngine.Object.DestroyImmediate(image);RenderTexture.active=old;return pixels;}
    static int Maximum(Color32[] pixels){int max=0;foreach(var p in pixels)max=Math.Max(max,Math.Max(p.r,Math.Max(p.g,p.b)));return max;}
    static int Difference(Color32[] a,Color32[] b){int max=0;for(int i=0;i<a.Length;i++)max=Math.Max(max,Math.Max(Math.Abs(a[i].r-b[i].r),Math.Max(Math.Abs(a[i].g-b[i].g),Math.Abs(a[i].b-b[i].b))));return max;}
    void LateUpdate(){try{
        var l=particles.lights;
        if(frame==0){var switches=index%8;var phase=index<8?0:(index/8)*0.25f;current=new Case{curve=index>=8,switches=switches,phase=phase,range=index<8?0.7f:0.2f+phase,intensity=index<8?0.6f:0.3f+1.2f*phase};
            particles.Play(false);var buffer=new ParticleSystem.Particle[1];particles.GetParticles(buffer);buffer[0].startLifetime=4;buffer[0].remainingLifetime=4*(1-phase);particles.SetParticles(buffer,1);
            l.range=index<8?new ParticleSystem.MinMaxCurve(0.7f):new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.2f,1,1.2f));l.intensity=index<8?new ParticleSystem.MinMaxCurve(0.6f):new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0.3f,1,1.5f));l.enabled=true;l.useParticleColor=(current.switches&1)!=0;l.sizeAffectsRange=(current.switches&2)!=0;l.alphaAffectsIntensity=(current.switches&4)!=0;reference.enabled=false;}
        if(frame==3){var buffer=new ParticleSystem.Particle[1];particles.GetParticles(buffer);current.phase=1-buffer[0].remainingLifetime/buffer[0].startLifetime;if(current.curve){current.range=0.2f+current.phase;current.intensity=0.3f+1.2f*current.phase;}native=Read();current.nativeMax=Maximum(native);l.enabled=false;reference.enabled=true;reference.range=3*current.range*((current.switches&2)!=0?2:1);reference.intensity=2*current.intensity*((current.switches&4)!=0?sourceColor.a:1);reference.color=(current.switches&1)!=0?templateColor*sourceColor:templateColor;}
        if(frame==6){var pixels=Read();current.referenceMax=Maximum(pixels);current.multiplyError=Difference(native,pixels);reference.color=(current.switches&1)!=0?sourceColor:templateColor;}
        if(frame==8){current.replaceError=Difference(native,Read());output.cases.Add(current);index++;frame=-1;if(index==32){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
        frame++;
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
#endif
