using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;

public static class NatsumeSceneMaterialProbe {
 [Serializable] public class Sample { public string label; public int[] slots; public int shadow; public bool probes; public int[] pixels; }
 [Serializable] public class Output { public string unityVersion; public Sample[] cases; public StateSample[] states;public LayerSample[] layers; }
 [Serializable] public class StateSample {public string label;public int src=1,dst=5,srcAlpha=1,dstAlpha=5,op,alphaOp,compare=7,cull,mask=15;public bool premultiply;public bool textured;public int uvSet;public bool mipmaps;public float bias;public float depth;public bool write;public int stencilCompare=7,stencilReference,stencilPass,stencilFail,stencilDepthFail,readMask=255,writeMask=255;public float[] tint;public float[] color;public float[] st;public float[] scale;public int[] pixels;}
 static StateSample[] States(Camera camera,MeshRenderer renderer,Mesh mesh,RenderTexture rt,Texture2D image){
  var result=new List<StateSample>();
  var texture=new Texture2D(8,8,TextureFormat.RGBA32,true,true);var texels=new Color[64];for(int y=0;y<8;y++)for(int x=0;x<8;x++)texels[y*8+x]=y<4?(x<4?Color.red:Color.green):(x<4?Color.blue:Color.yellow);texture.SetPixels(texels);texture.Apply(true);texture.wrapMode=TextureWrapMode.Clamp;
  var shader=Shader.Find("Hidden/Natsume/SceneMaterialProbe");if(!shader)throw new Exception("Missing state probe shader");
  var material=new Material(shader);renderer.sharedMaterials=new[]{material,material};
  int[] factors={0,1,3,6,5,10,2,4,7,8};int[] compares={1,2,3,4,5,6,7,8};
  Action<StateSample> capture=c=>{
   if(c.scale==null)c.scale=new[]{1f,1f,1f};renderer.transform.localScale=new Vector3(c.scale[0],c.scale[1],c.scale[2]);
   c.tint=new[]{.7f,.5f,.9f,.8f};c.color=new[]{.6f,.8f,.4f,.5f};c.st=new[]{1f,1f,0f,0f};
   if(c.textured){
   c.tint=new[]{1f,1f,1f,1f};c.color=new[]{1f,1f,1f,1f};c.st=c.label=="texture-st"?new[]{1f,1f,.5f,0f}:new[]{1f,1f,0f,0f};
    mesh.uv=c.uvSet==3?Enumerable.Repeat(new Vector2(.25f,.75f),8).ToArray():new[]{new Vector2(0,0),new Vector2(.5f,0),new Vector2(.5f,.5f),new Vector2(0,.5f),new Vector2(0,0),new Vector2(.5f,0),new Vector2(.5f,.5f),new Vector2(0,.5f)};
    material.mainTexture=texture;texture.filterMode=c.mipmaps?FilterMode.Trilinear:FilterMode.Point;
   }else{material.mainTexture=Texture2D.whiteTexture;}
   material.mainTextureScale=new Vector2(c.st[0],c.st[1]);material.mainTextureOffset=new Vector2(c.st[2],c.st[3]);material.SetFloat("_Bias",c.bias);
   mesh.colors=Enumerable.Repeat(new Color(c.color[0],c.color[1],c.color[2],c.color[3]),8).ToArray();
   material.SetColor("_Color",new Color(c.tint[0],c.tint[1],c.tint[2],c.tint[3]));material.SetInt("_Src",factors[c.src]);material.SetInt("_Dst",factors[c.dst]);material.SetInt("_SrcA",factors[c.srcAlpha]);material.SetInt("_DstA",factors[c.dstAlpha]);material.SetInt("_Op",c.op);material.SetInt("_OpA",c.alphaOp);material.SetInt("_ZTest",compares[c.compare]);material.SetInt("_Cull",c.cull);material.SetInt("_Mask",((c.mask&1)<<3)|((c.mask&2)<<1)|((c.mask&4)>>1)|((c.mask&8)>>3));material.SetFloat("_Premultiply",c.premultiply?1:0);
   camera.backgroundColor=new Color(.1f,.2f,.3f,.4f);camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();var p=image.GetPixel(16,32);c.pixels=new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)};result.Add(c);
  };
  foreach(bool pre in new[]{false,true})for(int i=0;i<10;i++)capture(new StateSample{label="blend-"+pre+"-"+i,src=i,dst=5,srcAlpha=4,dstAlpha=i,premultiply=pre});
  for(int i=0;i<5;i++)capture(new StateSample{label="operation-"+i,op=i,alphaOp=4-i});
  for(int i=0;i<8;i++)capture(new StateSample{label="compare-"+i,compare=i});
  for(int i=0;i<3;i++)capture(new StateSample{label="cull-"+i,cull=i});
  for(int i=0;i<16;i++)capture(new StateSample{label="mask-"+i,mask=i});
  capture(new StateSample{label="texture-base",textured=true});capture(new StateSample{label="texture-st",textured=true});capture(new StateSample{label="texture-uv3",textured=true,uvSet=3});capture(new StateSample{label="texture-mip-zero",textured=true,mipmaps=true});capture(new StateSample{label="texture-mip-bias",textured=true,mipmaps=true,bias=8});
  for(int axis=0;axis<3;axis++)foreach(int cull in new[]{1,2}){var scale=new[]{1f,1f,1f};scale[axis]=-1;capture(new StateSample{label="mirror-"+axis+"-"+cull,scale=scale,cull=cull});}
  renderer.transform.localScale=Vector3.one;
  mesh.colors=Enumerable.Repeat(Color.white,8).ToArray();mesh.uv=Enumerable.Repeat(Vector2.zero,8).ToArray();UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(texture);return result.ToArray();
 }
 [Serializable] public class LayerSample {public string label;public StateSample[] draws;public int[] pixels;}
 static LayerSample[] Layers(Camera camera,MeshRenderer original,Mesh mesh,RenderTexture rt,Texture2D image){
  var result=new List<LayerSample>();original.enabled=false;
  int[] compares={1,2,3,4,5,6,7,8};
  Func<string,StateSample[],LayerSample> capture=(label,draws)=>{
   var objects=new List<GameObject>();var materials=new List<Material>();
   for(int i=0;i<draws.Length;i++){
    var d=draws[i];var go=new GameObject("Layer "+i);objects.Add(go);go.transform.position=new Vector3(0,0,d.depth);go.AddComponent<MeshFilter>().sharedMesh=mesh;var r=go.AddComponent<MeshRenderer>();r.shadowCastingMode=ShadowCastingMode.Off;
    var m=new Material(Shader.Find("Hidden/Natsume/SceneMaterialProbe"));materials.Add(m);m.renderQueue=3000+i;r.sharedMaterial=m;m.SetInt("_Src",1);m.SetInt("_Dst",0);m.SetInt("_SrcA",1);m.SetInt("_DstA",0);m.SetColor("_Color",new Color(d.tint[0],d.tint[1],d.tint[2],d.tint[3]));m.SetInt("_ZWrite",d.write?1:0);m.SetInt("_ZTest",compares[d.compare]);m.SetInt("_StencilComp",compares[d.stencilCompare]);m.SetInt("_StencilRef",d.stencilReference);m.SetInt("_StencilPass",d.stencilPass);m.SetInt("_StencilFail",d.stencilFail);m.SetInt("_StencilZFail",d.stencilDepthFail);m.SetInt("_ReadMask",d.readMask);m.SetInt("_WriteMask",d.writeMask);
   }
   camera.backgroundColor=new Color(.1f,.2f,.3f,.4f);camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();var p=image.GetPixel(16,32);
   var sample=new LayerSample{label=label,draws=draws,pixels=new[]{Mathf.RoundToInt(p.r*255),Mathf.RoundToInt(p.g*255),Mathf.RoundToInt(p.b*255),Mathf.RoundToInt(p.a*255)}};
   foreach(var go in objects)UnityEngine.Object.DestroyImmediate(go);foreach(var m in materials)UnityEngine.Object.DestroyImmediate(m);return sample;
  };
  foreach(int compare in Enumerable.Range(0,8))result.Add(capture("depth-layer-"+compare,new[]{new StateSample{depth=.5f,write=true,tint=new[]{0f,0f,1f,1f}},new StateSample{depth=compare==2?.5f:0f,compare=compare,tint=new[]{1f,0f,0f,1f}}}));
  int[] values={0,0,5,1,0,255,1,255};
  foreach(int op in Enumerable.Range(0,8))result.Add(capture("stencil-layer-"+op,new[]{new StateSample{stencilReference=5,stencilPass=op,tint=new[]{0f,0f,1f,1f}},new StateSample{stencilCompare=2,stencilReference=values[op],tint=new[]{1f,0f,0f,1f}}}));
  result.Add(capture("stencil-mask",new[]{new StateSample{stencilReference=10,stencilPass=2,writeMask=3,tint=new[]{0f,0f,1f,1f}},new StateSample{stencilCompare=2,stencilReference=2,readMask=3,tint=new[]{1f,0f,0f,1f}}}));
  result.Add(capture("stencil-fail",new[]{new StateSample{stencilCompare=0,stencilReference=3,stencilFail=2,tint=new[]{0f,0f,1f,1f}},new StateSample{stencilCompare=2,stencilReference=3,tint=new[]{1f,0f,0f,1f}}}));
  result.Add(capture("stencil-depth-fail",new[]{new StateSample{write=true,tint=new[]{0f,0f,1f,1f}},new StateSample{depth=.5f,compare=1,stencilDepthFail=2,stencilReference=4,tint=new[]{0f,1f,0f,1f}},new StateSample{stencilCompare=2,stencilReference=4,tint=new[]{1f,0f,0f,1f}}}));
  original.enabled=true;return result.ToArray();
 }
 public static void Run(){
  Directory.CreateDirectory("Assets/SceneMaterialProbe");
  var mesh=new Mesh {name="Two submeshes"};
  mesh.vertices=new[]{new Vector3(-2,-1),new Vector3(0,-1),new Vector3(0,1),new Vector3(-2,1),new Vector3(0,-1),new Vector3(2,-1),new Vector3(2,1),new Vector3(0,1)};
  mesh.colors=Enumerable.Repeat(Color.white,8).ToArray();mesh.uv=Enumerable.Repeat(Vector2.zero,8).ToArray();
  mesh.SetUVs(3,Enumerable.Repeat(new Vector4(.25f,.75f,.5f,1),8).ToList());mesh.RecalculateNormals();
  mesh.subMeshCount=2;mesh.SetTriangles(new[]{0,1,2,0,2,3},0);mesh.SetTriangles(new[]{4,5,6,4,6,7},1);mesh.RecalculateNormals();mesh.RecalculateBounds();
  var path="Assets/SceneMaterialProbe/geometry.asset";AssetDatabase.DeleteAsset(path);AssetDatabase.CreateAsset(mesh,path);
  var go=new GameObject("Scene mesh");go.AddComponent<MeshFilter>().sharedMesh=mesh;var renderer=go.AddComponent<MeshRenderer>();
  var shader=Shader.Find("Sprites/Default");
  var mats=new[]{Color.red,Color.green,new Color(0,0,1,.5f),new Color(1,1,0,.5f)}.Select(c=>{var m=new Material(shader);m.color=c;return m;}).ToArray();
  var camGo=new GameObject("Scene material camera");var camera=camGo.AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=2;camera.aspect=1;camera.nearClipPlane=.1f;camera.farClipPlane=100;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;
  var rt=new RenderTexture(64,64,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);var image=new Texture2D(64,64,TextureFormat.RGBA32,false,true);camera.targetTexture=rt;
  var cases=new List<Sample>();
  Action<string,int[],int,bool> capture=(label,slots,shadow,probes)=>{
   renderer.sharedMaterials=slots.Select(i=>i<0?null:mats[i]).ToArray();renderer.shadowCastingMode=(ShadowCastingMode)shadow;renderer.receiveShadows=probes;renderer.lightProbeUsage=probes?LightProbeUsage.BlendProbes:LightProbeUsage.Off;renderer.reflectionProbeUsage=probes?ReflectionProbeUsage.BlendProbes:ReflectionProbeUsage.Off;
   camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();
   cases.Add(new Sample {label=label,slots=slots,shadow=shadow,probes=probes,pixels=new[]{16,48}.SelectMany(x=>{var c=image.GetPixel(x,32);return new[]{Mathf.RoundToInt(c.r*255),Mathf.RoundToInt(c.g*255),Mathf.RoundToInt(c.b*255),Mathf.RoundToInt(c.a*255)};}).ToArray()});
  };
  foreach(var slots in new[]{new int[0],new[]{0},new[]{0,1},new[]{0,1,2},new[]{0,1,2,3},new[]{-1,1},new[]{0,-1},new[]{-1,-1}})capture("slots-"+string.Join("-",slots),slots,0,false);
  foreach(int shadow in new[]{0,1,2,3})capture("environment-"+shadow,new[]{0,1},shadow,true);
  renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;renderer.lightProbeUsage=LightProbeUsage.Off;renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;
  var states=States(camera,renderer,mesh,rt,image);var layers=Layers(camera,renderer,mesh,rt,image);
  renderer.sharedMaterials=new[]{AssetDatabase.GetBuiltinExtraResource<Material>("Sprites-Default.mat"),AssetDatabase.GetBuiltinExtraResource<Material>("Sprites-Default.mat")};
  PrefabUtility.SaveAsPrefabAsset(go,"Assets/SceneMaterialProbe/scene.prefab");AssetDatabase.SaveAssets();
  var output=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");File.WriteAllText(output,JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray(),states=states,layers=layers},true));
  camera.targetTexture=null;RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(camGo);UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(image);foreach(var m in mats)UnityEngine.Object.DestroyImmediate(m);
 }
}
