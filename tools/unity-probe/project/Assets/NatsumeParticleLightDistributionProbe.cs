#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

public sealed class NatsumeParticleLightDistributionProbe : MonoBehaviour
{
    [Serializable] public class Case{public float ratio;public int maximum;public uint seed;public bool random;public int[] lit;public bool mortality;public int[] afterDeath;public int[] afterBirth;}
    [Serializable] public class Output{public string unityVersion;public List<Case> cases=new List<Case>();}
    readonly Output output=new Output();ParticleSystem ps;Camera camera;RenderTexture target;int index,frame;
    public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("light-distribution").AddComponent<NatsumeParticleLightDistributionProbe>();EditorApplication.EnterPlaymode();}
    void Start(){
        Time.captureFramerate=60;output.unityVersion=Application.unityVersion;RenderSettings.ambientMode=AmbientMode.Flat;RenderSettings.ambientLight=Color.black;QualitySettings.pixelLightCount=8;
        var material=new Material(Shader.Find("Legacy Shaders/Diffuse")){color=Color.white};
        for(int i=0;i<64;i++){var quad=GameObject.CreatePrimitive(PrimitiveType.Quad);quad.transform.position=new Vector3(i*4,0,0);quad.transform.localScale=new Vector3(2,2,1);quad.GetComponent<MeshRenderer>().sharedMaterial=material;}
        camera=new GameObject("camera").AddComponent<Camera>();camera.transform.position=new Vector3(126,0,-4);camera.orthographic=true;camera.orthographicSize=1;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;camera.nearClipPlane=0.01f;camera.farClipPlane=20;camera.enabled=false;
        target=new RenderTexture(2048,16,24,RenderTextureFormat.ARGB32);target.Create();camera.targetTexture=target;
        var template=new GameObject("template").AddComponent<Light>();template.type=LightType.Point;template.renderMode=LightRenderMode.ForcePixel;template.transform.position=new Vector3(1000,0,-0.2f);template.range=1;template.intensity=4;template.shadows=LightShadows.None;
        ps=new GameObject("particles").AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.loop=false;m.startLifetime=100;m.startSpeed=0;m.maxParticles=64;m.simulationSpace=ParticleSystemSimulationSpace.World;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
        var e=ps.emission;e.enabled=false;var sh=ps.shape;sh.enabled=false;ps.GetComponent<ParticleSystemRenderer>().renderMode=ParticleSystemRenderMode.None;
        var l=ps.lights;l.enabled=true;l.light=template;l.useParticleColor=false;l.alphaAffectsIntensity=false;l.sizeAffectsRange=false;
        foreach(float ratio in new[]{0f,0.1f,0.25f,0.3f,0.5f,0.7f,1f})foreach(int maximum in new[]{1,8,64})foreach(bool random in new[]{false,true})foreach(uint seed in new[]{123u,456u})output.cases.Add(new Case{ratio=ratio,maximum=maximum,random=random,seed=seed});
        foreach(bool random in new[]{false,true})output.cases.Add(new Case{ratio=1,maximum=1,random=random,seed=123,mortality=true});
        for(uint seed=0;seed<128;seed++)output.cases.Add(new Case{ratio=0.25f,maximum=64,random=true,seed=1000+seed});
    }
    void LateUpdate(){try{
        var c=output.cases[index];
        if(frame==0){ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=c.seed;var l=ps.lights;l.ratio=c.ratio;l.maxLights=c.maximum;l.useRandomDistribution=c.random;ps.Play(false);for(int i=0;i<64;i++)ps.Emit(new ParticleSystem.EmitParams{position=new Vector3(i*4,0,-0.2f),startLifetime=c.mortality&&i==0?0.15f:100f},1);}
        if(frame==3 || (c.mortality&&(frame==15||frame==20))){
            var lit=ReadLights();
            if(frame==3)c.lit=lit;
            else if(frame==15){c.afterDeath=lit;ps.Emit(new ParticleSystem.EmitParams{position=new Vector3(0,0,-0.2f),startLifetime=100},1);}
            else c.afterBirth=lit;
            if(!c.mortality||frame==20){index++;frame=-1;if(index==output.cases.Count){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
        }
        frame++;
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
    int[] ReadLights(){camera.Render();var old=RenderTexture.active;RenderTexture.active=target;var image=new Texture2D(2048,16,TextureFormat.RGBA32,false);image.ReadPixels(new Rect(0,0,2048,16),0,0);image.Apply();var pixels=image.GetPixels32();var lit=new List<int>();for(int i=0;i<64;i++)if(pixels[8*2048+i*32+16].r>4)lit.Add(i);UnityEngine.Object.DestroyImmediate(image);RenderTexture.active=old;return lit.ToArray();}
}
#endif
