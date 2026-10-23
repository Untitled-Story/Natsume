using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
public static class NatsumeSpriteMaskProbe {
 [Serializable] public class Sample {public string label;public int interaction,order;public bool custom,second,particle;public float cutoff,z;public int sortPoint;public int[] pixels;}
 [Serializable] public class Output {public string unityVersion;public Sample[] cases;}
 public static void Run(){
  var texture=new Texture2D(8,8,TextureFormat.RGBA32,false,true);texture.filterMode=FilterMode.Point;texture.wrapMode=TextureWrapMode.Clamp;
  texture.SetPixels(Enumerable.Range(0,64).Select(i=>new Color(1,1,1,(i%8)/7f)).ToArray());texture.Apply();
  var source=Sprite.Create(texture,new Rect(0,0,8,8),new Vector2(.5f,.5f),1,0,SpriteMeshType.FullRect);
  var white=new Texture2D(1,1,TextureFormat.RGBA32,false,true);white.SetPixel(0,0,Color.white);white.Apply();
  var content=Sprite.Create(white,new Rect(0,0,1,1),new Vector2(.5f,.5f),1,0,SpriteMeshType.FullRect);
  var camGo=new GameObject("Camera");var camera=camGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=8;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;camera.allowMSAA=false;
  var target=new RenderTexture(32,32,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.antiAliasing=1;camera.targetTexture=target;
  var read=new Texture2D(32,32,TextureFormat.RGBA32,false,true);var cases=new List<Sample>();
  foreach(bool particle in new[]{false,true})foreach(int interaction in new[]{0,1,2})foreach(int order in new[]{-2,-1,0,1,2})foreach(bool custom in new[]{false,true})foreach(float cutoff in new[]{0f,.5f,1f})foreach(bool second in new[]{false,true})
  foreach(float z in !particle&&interaction==1&&order==0&&!custom&&cutoff==.5f&&!second?new[]{-2f,0f,2f}:new[]{0f})
  foreach(int sortPoint in !particle&&interaction==1&&order==0&&!custom&&cutoff==.5f&&!second?new[]{0,1}:new[]{0}) {
   var root=new GameObject("Root");
   var go=new GameObject("Mask");go.transform.SetParent(root.transform,false);go.transform.position=new Vector3(-1,0,z);
   var mask=go.AddComponent<SpriteMask>();mask.sprite=source;mask.spriteSortPoint=(SpriteSortPoint)sortPoint;mask.alphaCutoff=cutoff;mask.isCustomRangeActive=custom;mask.backSortingOrder=-1;mask.frontSortingOrder=1;
   if(second){var extra=new GameObject("Mask2");extra.transform.SetParent(root.transform,false);extra.transform.position=new Vector3(3,2,0);extra.transform.localScale=new Vector3(.5f,.5f,1);var m=extra.AddComponent<SpriteMask>();m.sprite=source;m.alphaCutoff=cutoff;m.isCustomRangeActive=custom;m.backSortingOrder=-1;m.frontSortingOrder=1;}
   var graphic=new GameObject("Graphic");graphic.transform.SetParent(root.transform,false);graphic.transform.localScale=new Vector3(14,12,1);var sr=graphic.AddComponent<SpriteRenderer>();sr.sprite=content;sr.color=new Color(.8f,.4f,.2f,.7f);sr.sortingOrder=order;sr.maskInteraction=(SpriteMaskInteraction)interaction;
   Material particleMaterial=null;
   if(particle){
    sr.enabled=false;graphic.transform.localScale=Vector3.one;
    var ps=graphic.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var main=ps.main;main.playOnAwake=false;main.maxParticles=1;main.startSize3D=true;var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;
    var pr=graphic.GetComponent<ParticleSystemRenderer>();pr.renderMode=ParticleSystemRenderMode.Billboard;pr.maxParticleSize=1;pr.maskInteraction=(SpriteMaskInteraction)interaction;pr.sortingOrder=order;
    particleMaterial=new Material(Shader.Find("Sprites/Default"));particleMaterial.mainTexture=white;pr.sharedMaterial=particleMaterial;
    ps.Play();ps.Pause();ps.SetParticles(new[]{new ParticleSystem.Particle{position=Vector3.zero,startSize3D=new Vector3(14,12,1),startColor=new Color(.8f,.4f,.2f,.7f),startLifetime=100,remainingLifetime=100}},1);ps.Simulate(.001f,false,false,true);
   }
   camera.Render();RenderTexture.active=target;read.ReadPixels(new Rect(0,0,32,32),0,0);read.Apply();RenderTexture.active=null;
   cases.Add(new Sample{label=z+"-"+sortPoint+"-"+particle+"-"+interaction+"-"+order+"-"+custom+"-"+cutoff+"-"+second,z=z,sortPoint=sortPoint,particle=particle,interaction=interaction,order=order,custom=custom,cutoff=cutoff,second=second,pixels=Enumerable.Range(0,1024).SelectMany(i=>{var p=read.GetPixel(i%32,31-i/32);return new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};}).ToArray()});UnityEngine.Object.DestroyImmediate(root);if(particleMaterial)UnityEngine.Object.DestroyImmediate(particleMaterial);
  }
  File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
  foreach(var o in new UnityEngine.Object[]{camGo,target,read,source,content,texture,white})UnityEngine.Object.DestroyImmediate(o);
 }
}
