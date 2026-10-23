using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public static class NatsumeUIMaskProbe {
 [Serializable] public class Sample {public string label;public int depth,rectMode,nestedOrder;public bool nested;public bool showGraphic,maskable,ignoreGroup,cull;public float groupAlpha;public int[] pixels;}
 [Serializable] public class Output {public string unityVersion;public Sample[] cases;}
 static GameObject RectNode(string name,Transform parent,float w,float h,float x=0,float y=0) {
  var go=new GameObject(name,typeof(RectTransform));go.transform.SetParent(parent,false);
  var r=go.GetComponent<RectTransform>();r.sizeDelta=new Vector2(w,h);r.anchoredPosition=new Vector2(x,y);return go;
 }
 public static void Run() {
  QualitySettings.antiAliasing=0;
  var texture=new Texture2D(16,16,TextureFormat.RGBA32,false,true);texture.filterMode=FilterMode.Bilinear;texture.wrapMode=TextureWrapMode.Clamp;
  texture.SetPixels(Enumerable.Range(0,256).Select(i=>new Color((i%16)/15f,(i/16)/15f,.5f,.2f+.6f*(i%5)/4f)).ToArray());texture.Apply();
  var sprite=Sprite.Create(texture,new Rect(0,0,16,8),new Vector2(.25f,1.25f),100,0,SpriteMeshType.FullRect,new Vector4(2,1,3,2));
  var camGo=new GameObject("Camera");var camera=camGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=48;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;camera.allowMSAA=false;
  var target=new RenderTexture(128,96,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.antiAliasing=1;camera.targetTexture=target;
  var pixels=new Texture2D(128,96,TextureFormat.RGBA32,false,true);var cases=new List<Sample>();
  Action<Sample> capture=c=>{
   var root=RectNode("Canvas",null,128,96);root.AddComponent<Canvas>().renderMode=RenderMode.WorldSpace;
   root.SetActive(false);root.AddComponent<CanvasGroup>().alpha=c.groupAlpha;
   Transform parent=root.transform;
   for(int i=0;i<c.depth;i++){
    var go=RectNode("Mask"+i,parent,68-i*16,48-i*10,i==0?-4:8,i==0?0:2);
    var image=go.AddComponent<Image>();image.sprite=sprite;image.color=new Color(.3f,.8f,.4f,.7f);
    var mask=go.AddComponent<Mask>();mask.showMaskGraphic=c.showGraphic;parent=go.transform;
   }
   if(c.rectMode>0) {
    var clip=RectNode("Clip",parent,38,26,3,-2);var mask=clip.AddComponent<RectMask2D>();
    mask.padding=new Vector4(1,2,3,4);mask.softness=c.rectMode>=2?new Vector2Int(2,3):Vector2Int.zero;parent=clip.transform;
    if(c.rectMode==3){var inner=RectNode("InnerClip",parent,28,22,-2,3);var m=inner.AddComponent<RectMask2D>();m.padding=new Vector4(0,1,2,0);m.softness=new Vector2Int(4,1);parent=inner.transform;}
   }
   if(c.nested){var nested=RectNode("Nested",parent,128,96);var cv=nested.AddComponent<Canvas>();cv.overrideSorting=true;cv.sortingOrder=c.nestedOrder;parent=nested.transform;}
   var group=RectNode("Group",parent,128,96);var cg=group.AddComponent<CanvasGroup>();cg.alpha=.7f;cg.ignoreParentGroups=c.ignoreGroup;
   var graphic=RectNode("Graphic",group.transform,82,56,6,1);var content=graphic.AddComponent<Image>();content.sprite=sprite;content.color=new Color(.9f,.6f,.8f,.63f);content.maskable=c.maskable;graphic.GetComponent<CanvasRenderer>().cullTransparentMesh=c.cull;
   root.SetActive(true);if(c.nested){var cv=root.GetComponentsInChildren<Canvas>().Last();cv.overrideSorting=true;cv.sortingOrder=c.nestedOrder;}Canvas.ForceUpdateCanvases();camera.Render();
   RenderTexture.active=target;pixels.ReadPixels(new Rect(0,0,128,96),0,0);pixels.Apply();RenderTexture.active=null;
   c.pixels=Enumerable.Range(0,128*96).SelectMany(i=>{var p=pixels.GetPixel(i%128,95-i/128);return new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};}).ToArray();cases.Add(c);UnityEngine.Object.DestroyImmediate(root);
  };
  foreach(int depth in new[]{0,1,2})foreach(int rectMode in new[]{0,1,2,3})
  foreach(bool show in new[]{false,true})foreach(bool maskable in new[]{false,true})
   capture(new Sample{label=depth+"-"+rectMode+"-"+show+"-"+maskable,depth=depth,rectMode=rectMode,showGraphic=show,maskable=maskable,groupAlpha=.8f});
  foreach(float alpha in new[]{0f,.37f})foreach(bool ignore in new[]{false,true})foreach(bool cull in new[]{false,true})
   capture(new Sample{label="group-"+alpha+"-"+ignore+"-"+cull,depth=1,rectMode=2,showGraphic=true,maskable=true,groupAlpha=alpha,ignoreGroup=ignore,cull=cull});
  foreach(int order in new[]{-1,0,1})capture(new Sample{label="nested-"+order,depth=2,rectMode=2,showGraphic=true,maskable=true,groupAlpha=.8f,nested=true,nestedOrder=order});
  File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
  foreach(var o in new UnityEngine.Object[]{camGo,target,pixels,sprite,texture})UnityEngine.Object.DestroyImmediate(o);
 }
}
