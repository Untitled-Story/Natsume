// Native built-in shader pixels with a perspective view and an opaque depth-writing plane.
using System;
using System.Collections.Generic;
using UnityEngine;
public static class NatsumeLegacyMaterialProbe {
 [Serializable] public class Sample {public string label,model,fog;public float backgroundDepth,particleDepth=10,density,start=5,end=15;public int[] pixels;}
 public static Sample[] Measure(){
 var go=new GameObject("Legacy particles");var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
 var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.maxParticles=1;main.startLifetime=10;var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;
 var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.alignment=ParticleSystemRenderSpace.World;renderer.maxParticleSize=100;
 var cameraObject=new GameObject("Legacy camera");var camera=cameraObject.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.nearClipPlane=.1f;camera.farClipPlane=100;camera.fieldOfView=60;camera.aspect=1;camera.depthTextureMode=DepthTextureMode.Depth;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.blue;
 var plane=GameObject.CreatePrimitive(PrimitiveType.Quad);plane.transform.position=new Vector3(0,0,.5f);plane.transform.localScale=Vector3.one*30;
 var background=new Material(Shader.Find("Standard"));background.color=Color.black;background.SetColor("_EmissionColor",Color.blue);background.EnableKeyword("_EMISSION");plane.GetComponent<MeshRenderer>().sharedMaterial=background;
 var rt=new RenderTexture(64,64,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);camera.targetTexture=rt;var image=new Texture2D(64,64,TextureFormat.RGBA32,false,true);
 var materials=new List<Material>();var samples=new List<Sample>();bool previousFog=RenderSettings.fog,previousSoft=QualitySettings.softParticles;var previousColor=RenderSettings.fogColor;var previousMode=RenderSettings.fogMode;float previousDensity=RenderSettings.fogDensity,previousStart=RenderSettings.fogStartDistance,previousEnd=RenderSettings.fogEndDistance;var previousTarget=RenderTexture.active;QualitySettings.softParticles=true;
 try{
 foreach(string model in new[]{"alpha","additive"}){
 var shader=Shader.Find(model=="alpha"?"Legacy Shaders/Particles/Alpha Blended":"Legacy Shaders/Particles/Additive");if(!shader)throw new Exception("Missing legacy shader");var material=new Material(shader);materials.Add(material);material.SetTexture("_MainTex",Texture2D.whiteTexture);material.SetColor("_TintColor",new Color(.5f,.5f,.5f,.5f));material.SetFloat("_InvFade",1);renderer.sharedMaterial=material;
 foreach(string fog in new[]{"none","linear","exp","exp2"}) foreach(float gap in fog=="none"?new[]{-.25f,0,.1f,.5f,1f,2f}:new[]{0f}){
 bool soft=fog=="none";plane.SetActive(soft);plane.transform.position=new Vector3(0,0,gap);if(soft)material.EnableKeyword("SOFTPARTICLES_ON");else material.DisableKeyword("SOFTPARTICLES_ON");
 RenderSettings.fog=!soft;RenderSettings.fogColor=Color.green;RenderSettings.fogMode=fog=="linear"?FogMode.Linear:fog=="exp"?FogMode.Exponential:FogMode.ExponentialSquared;RenderSettings.fogStartDistance=5;RenderSettings.fogEndDistance=15;float density=fog=="exp2"?Mathf.Sqrt(Mathf.Log(2))/10:Mathf.Log(2)/10;RenderSettings.fogDensity=density;
 ps.Simulate(0,false,true,false);ps.SetParticles(new[]{new ParticleSystem.Particle{position=Vector3.zero,startSize=4,startColor=new Color(1,0,0,.5f),startLifetime=10,remainingLifetime=10,randomSeed=1}},1);
 camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();var p=image.GetPixel(32,32);
 samples.Add(new Sample{label=model+"-"+(soft?"soft-"+gap:fog),model=model,fog=fog,backgroundDepth=10+gap,density=density,pixels=new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255)}});
 }}return samples.ToArray();
 }finally{RenderSettings.fog=previousFog;RenderSettings.fogColor=previousColor;RenderSettings.fogMode=previousMode;RenderSettings.fogDensity=previousDensity;RenderSettings.fogStartDistance=previousStart;RenderSettings.fogEndDistance=previousEnd;QualitySettings.softParticles=previousSoft;camera.targetTexture=null;RenderTexture.active=previousTarget;UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(cameraObject);UnityEngine.Object.DestroyImmediate(plane);UnityEngine.Object.DestroyImmediate(background);UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(image);foreach(var m in materials)UnityEngine.Object.DestroyImmediate(m);}
 }
}
