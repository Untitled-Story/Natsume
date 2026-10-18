using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
public static class NatsumeCompatibilityProbe {
 [Serializable] public class Sample { public int frame,count; public Vector3[] positions,velocities,rotations,sizes,vertices; public Vector2[] uv; }
 [Serializable] public class Case { public string label; public Sample[] samples; }
 [Serializable] public class CurveCase { public string label; public float[] values; }
 [Serializable] public class Output { public string unityVersion; public Case[] cases; public CurveCase[] curves; public Color[] gradient; public RenderCheck[] renderChecks; }

 [Serializable] public class RenderCheck { public string label; public int[] native, trs, tr, identity, bakedTransform; }
 static List<RenderCheck> renderChecks = new List<RenderCheck>();
 static Camera camera;
 static int[] PixelBounds() {
 var rt=new RenderTexture(256,256,24);camera.targetTexture=rt;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;
 camera.Render();RenderTexture.active=rt;var image=new Texture2D(256,256,TextureFormat.RGB24,false);image.ReadPixels(new Rect(0,0,256,256),0,0);image.Apply();
 int minX=256,minY=256,maxX=-1,maxY=-1;var pixels=image.GetPixels32();for(int y=0;y<256;y++)for(int x=0;x<256;x++){var p=pixels[y*256+x];if(p.r+p.g+p.b>100){minX=Math.Min(minX,x);minY=Math.Min(minY,y);maxX=Math.Max(maxX,x);maxY=Math.Max(maxY,y);}}
 camera.targetTexture=null;RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(image);UnityEngine.Object.DestroyImmediate(rt);return new[]{minX,minY,maxX,maxY};
 }
 static void CheckRender(ParticleSystem ps,string label) {
 var r=ps.GetComponent<ParticleSystemRenderer>();var material=new Material(Shader.Find("Hidden/Internal-Colored"));material.SetInt("_Cull",0);material.SetInt("_ZWrite",0);material.SetInt("_SrcBlend",1);material.SetInt("_DstBlend",0);material.SetColor("_Color",Color.white);r.sharedMaterial=material;
 var result=new RenderCheck{label=label,native=PixelBounds()};
 var mesh=new Mesh();r.BakeMesh(mesh,camera,false);r.enabled=false;
 var go=new GameObject("Baked");go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
 go.transform.position=ps.transform.position;go.transform.rotation=ps.transform.rotation;go.transform.localScale=ps.transform.lossyScale;result.trs=PixelBounds();
 go.transform.localScale=Vector3.one;result.tr=PixelBounds();
 go.transform.SetPositionAndRotation(Vector3.zero,Quaternion.identity);result.identity=PixelBounds();
 r.BakeMesh(mesh,camera,true);result.bakedTransform=PixelBounds();renderChecks.Add(result);r.enabled=true;UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(material);
 }

 static ParticleSystem Create() { var ps=new GameObject("Compatibility").AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=12345;var m=ps.main;m.duration=1;m.loop=false;m.playOnAwake=false;m.startLifetime=2;m.startSpeed=0;m.startSize=1;m.gravityModifier=0;m.scalingMode=ParticleSystemScalingMode.Local;var e=ps.emission;e.enabled=false;var s=ps.shape;s.enabled=false;var r=ps.GetComponent<ParticleSystemRenderer>();r.alignment=ParticleSystemRenderSpace.World;r.maxParticleSize=100;return ps; }
 static Sample Read(ParticleSystem ps,int frame,bool bake) {var p=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(p);var s=new Sample{frame=frame,count=p.Length,positions=p.Select(x=>x.position).ToArray(),velocities=p.Select(x=>x.velocity).ToArray(),rotations=p.Select(x=>x.rotation3D).ToArray(),sizes=p.Select(x=>x.GetCurrentSize3D(ps)).ToArray()};if(bake&&p.Length>0){var mesh=new Mesh();ps.GetComponent<ParticleSystemRenderer>().BakeMesh(mesh,camera,true);s.vertices=mesh.vertices;s.uv=mesh.uv;UnityEngine.Object.DestroyImmediate(mesh);}return s;}
 static Case Manual(string label,Action<ParticleSystem> configure,bool bake=false,Vector3? particleRotation=null) {var ps=Create();configure(ps);ps.Simulate(0,false,true,false);ps.SetParticles(new[]{new ParticleSystem.Particle{position=new Vector3(1,.5f,.2f),velocity=new Vector3(2,1,.5f),startLifetime=2,remainingLifetime=2,startSize3D=new Vector3(2,3,4),rotation3D=particleRotation??new Vector3(20,35,55),startColor=Color.white,randomSeed=1000}},1);if(label.StartsWith("scaling-")||label.StartsWith("render-Billboard"))CheckRender(ps,label);var a=new List<Sample>{Read(ps,0,bake)};for(int frame=1;frame<=60;frame++){ps.Simulate(1f/60,false,false,false);if(frame<=3||frame==15||frame==30||frame==60)a.Add(Read(ps,frame,bake));}var result=new Case{label=label,samples=a.ToArray()};UnityEngine.Object.DestroyImmediate(ps.gameObject);return result;}
 public static void Run(){try{camera=new GameObject("Camera").AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=20;camera.aspect=1;var cases=new List<Case>();
 foreach(var kind in new[]{"axes","axes-world","axes-world-simworld","axes-local-simworld","axes-world-negative","axes-world-angle30","axes-dampen0","axes-dampen1","drag","drag-size","drag-velocity","drag-both","drag-size-lifetime","axes-drag"})cases.Add(Manual("limit-"+kind,ps=>{
 var m=ps.main;
 if(kind.Contains("simworld")) m.simulationSpace=ParticleSystemSimulationSpace.World;
 if(kind.Contains("world")||kind.Contains("simworld"))ps.transform.rotation=Quaternion.Euler(0,0,kind.Contains("negative")?-45:kind.Contains("angle30")?30:45);
 var l=ps.limitVelocityOverLifetime;l.enabled=true;l.limit=100;l.dampen=kind=="axes-dampen0"?0:kind=="axes-dampen1"?1:.26f;
 if(kind.StartsWith("axes")){l.separateAxes=true;l.limitX=.4f;l.limitY=.2f;l.limitZ=.1f;l.space=kind.Contains("world")&&!kind.Contains("local")?ParticleSystemSimulationSpace.World:ParticleSystemSimulationSpace.Local;}
 if(kind.StartsWith("drag")||kind=="axes-drag"){l.drag=.7f;l.multiplyDragByParticleSize=kind.Contains("size")||kind=="drag-both";l.multiplyDragByParticleVelocity=kind=="drag-velocity"||kind=="drag-both";}
 if(kind=="drag-size-lifetime"){var size=ps.sizeOverLifetime;size.enabled=true;size.size=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,.5f,1,2));}
 }));
 foreach(var kind in new[]{"fps","fps-curve","fps-start","fps-row","speed","speed-clamp","row-fixed","row-random","row-mesh","no-uv"})cases.Add(Manual("sheet-"+kind,ps=>{var s=ps.textureSheetAnimation;s.enabled=true;s.numTilesX=4;s.numTilesY=3;s.frameOverTime=new ParticleSystem.MinMaxCurve(1,AnimationCurve.Linear(0,0,1,1));s.timeMode=kind.StartsWith("fps")?ParticleSystemAnimationTimeMode.FPS:kind.StartsWith("speed")?ParticleSystemAnimationTimeMode.Speed:ParticleSystemAnimationTimeMode.Lifetime;s.fps=6;s.speedRange=new Vector2(0,4);if(kind=="fps-curve")s.frameOverTime=.25f;if(kind=="fps-start")s.startFrame=.25f;if(kind=="speed-clamp")s.speedRange=new Vector2(0,1);if(kind.StartsWith("row-")||kind=="fps-row"){s.animation=ParticleSystemAnimationType.SingleRow;s.rowIndex=1;s.rowMode=kind=="row-fixed"||kind=="fps-row"?ParticleSystemAnimationRowMode.Custom:kind=="row-random"?ParticleSystemAnimationRowMode.Random:ParticleSystemAnimationRowMode.MeshIndex;}if(kind=="no-uv")s.uvChannelMask=UnityEngine.Rendering.UVChannelFlags.UV1;},true));
 foreach(var mode in new[]{ParticleSystemRenderMode.HorizontalBillboard,ParticleSystemRenderMode.VerticalBillboard,ParticleSystemRenderMode.Billboard})foreach(var align in new[]{ParticleSystemRenderSpace.World,ParticleSystemRenderSpace.Facing,ParticleSystemRenderSpace.Velocity})cases.Add(Manual("render-"+mode+"-"+align,ps=>{var r=ps.GetComponent<ParticleSystemRenderer>();r.renderMode=mode;r.alignment=align;},true));
 foreach(var rotate in new[]{false,true})cases.Add(Manual("freeform-"+rotate,ps=>{var r=ps.GetComponent<ParticleSystemRenderer>();r.renderMode=ParticleSystemRenderMode.Stretch;r.freeformStretching=true;r.rotateWithStretchDirection=rotate;r.lengthScale=2;r.velocityScale=.4f;},true));
 foreach(var flip in new[]{0f,1f}){var ps=Create();var m=ps.main;m.flipRotation=flip;m.startRotation=.7f;ps.Emit(8);cases.Add(new Case{label="flip-"+flip,samples=new[]{Read(ps,0,false)}});UnityEngine.Object.DestroyImmediate(ps.gameObject);}

 foreach(var kind in new[]{"local","hierarchy","shape","local-rotated","hierarchy-rotated","shape-rotated"}) {
 var parent=new GameObject("ScalingParent"); parent.transform.localScale=new Vector3(2,3,4);
 var result=Manual("scaling-"+kind,ps=>{ps.transform.SetParent(parent.transform,false);ps.transform.localScale=new Vector3(.5f,2,1);if(kind.Contains("rotated")){parent.transform.rotation=Quaternion.Euler(0,0,30);ps.transform.localRotation=Quaternion.Euler(0,0,45);}var m=ps.main;m.scalingMode=kind.StartsWith("hierarchy")?ParticleSystemScalingMode.Hierarchy:kind.StartsWith("shape")?ParticleSystemScalingMode.Shape:ParticleSystemScalingMode.Local;},true);
 cases.Add(result);UnityEngine.Object.DestroyImmediate(parent);
 }

 foreach(var kind in new[]{"local","hierarchy","shape"})foreach(var world in new[]{false,true}) {
 var parent=new GameObject("BirthParent");parent.transform.localScale=new Vector3(2,3,4);var ps=Create();ps.transform.SetParent(parent.transform,false);ps.transform.localScale=new Vector3(.5f,2,1);var m=ps.main;m.scalingMode=kind=="hierarchy"?ParticleSystemScalingMode.Hierarchy:kind=="shape"?ParticleSystemScalingMode.Shape:ParticleSystemScalingMode.Local;m.simulationSpace=world?ParticleSystemSimulationSpace.World:ParticleSystemSimulationSpace.Local;m.startSpeed=1;
 var shape=ps.shape;shape.enabled=true;shape.shapeType=ParticleSystemShapeType.SingleSidedEdge;shape.radius=0;shape.position=new Vector3(1,.5f,.2f);
 ps.Emit(1);var samples=new List<Sample>{Read(ps,0,true)};ps.Simulate(1f/60,false,false,false);samples.Add(Read(ps,1,true));cases.Add(new Case{label="scaling-birth-"+kind+"-"+world,samples=samples.ToArray()});UnityEngine.Object.DestroyImmediate(parent);
 }
 foreach(var axes in new[]{false,true})foreach(var flip in new[]{0f,1f}){
 var ps=Create();var m=ps.main;m.flipRotation=flip;m.startRotation3D=axes;m.startRotationX=.2f;m.startRotationY=.4f;m.startRotationZ=.7f;
 var r=ps.rotationOverLifetime;r.enabled=true;r.separateAxes=axes;r.x=.1f;r.y=.3f;r.z=.5f;
 ps.Emit(1);var samples=new List<Sample>{Read(ps,0,false)};for(int frame=1;frame<=3;frame++){ps.Simulate(1f/60,false,false,false);samples.Add(Read(ps,frame,false));}
 cases.Add(new Case{label="flip-rotation-"+axes+"-"+flip,samples=samples.ToArray()});UnityEngine.Object.DestroyImmediate(ps.gameObject);
 }

 foreach(var kind in new[]{"local","world","fractional","delay","teleport"}) {
 var ps=Create();var m=ps.main;m.duration=1;m.startSpeed=0;if(kind=="world")m.simulationSpace=ParticleSystemSimulationSpace.World;if(kind=="delay")m.startDelay=.05f;var emission=ps.emission;emission.enabled=true;emission.rateOverTime=0;emission.rateOverDistance=kind=="fractional"?1.5f:2;
 ps.Simulate(0,false,true,false);ps.Play(false);var samples=new List<Sample>{Read(ps,0,false)};
 for(int frame=1;frame<=12;frame++){ps.transform.position=new Vector3(kind=="teleport"?(frame>=3?10:0):frame*.25f,0,0);ps.Simulate(1f/60,false,false,false);samples.Add(Read(ps,frame,false));}
 cases.Add(new Case{label="distance-"+kind,samples=samples.ToArray()});UnityEngine.Object.DestroyImmediate(ps.gameObject);
 }

 foreach(var kind in new[]{"world-orbital","local-worldsim","world-radial","world-offset","world-combined","world-scaled","world-translated","local-scaled"})cases.Add(Manual("velocity-"+kind,ps=>{
 ps.transform.rotation=Quaternion.Euler(0,0,45);if(kind.Contains("scaled"))ps.transform.localScale=new Vector3(2,3,1);if(kind.Contains("translated"))ps.transform.position=new Vector3(2,3,4);
 var m=ps.main;if(kind.Contains("worldsim"))m.simulationSpace=ParticleSystemSimulationSpace.World;
 var v=ps.velocityOverLifetime;v.enabled=true;v.space=kind.StartsWith("world")?ParticleSystemSimulationSpace.World:ParticleSystemSimulationSpace.Local;
 if(!kind.Contains("radial")){v.orbitalX=1;v.orbitalY=.5f;v.orbitalZ=.7f;}
 if(kind.Contains("offset")||kind.Contains("combined")||kind.Contains("translated")){v.orbitalOffsetX=.2f;v.orbitalOffsetY=-.3f;v.orbitalOffsetZ=.4f;}
 if(kind.Contains("radial")||kind.Contains("combined")||kind.Contains("translated"))v.radial=.4f;
 if(kind.Contains("combined")){v.x=1;v.y=2;v.z=3;v.speedModifier=2;}
 }));

 foreach(var align in new[]{ParticleSystemRenderSpace.World,ParticleSystemRenderSpace.Facing,ParticleSystemRenderSpace.Velocity})cases.Add(Manual("align-zero-"+align,ps=>ps.GetComponent<ParticleSystemRenderer>().alignment=align,true,Vector3.zero));
 foreach(var rotate in new[]{false,true})cases.Add(Manual("freeform-zero-"+rotate,ps=>{var r=ps.GetComponent<ParticleSystemRenderer>();r.renderMode=ParticleSystemRenderMode.Stretch;r.freeformStretching=true;r.rotateWithStretchDirection=rotate;r.lengthScale=2;r.velocityScale=.4f;},true,Vector3.zero));
 var curves=new List<CurveCase>();foreach(var weight in new[]{0f,.1f,.5f,1f}){var a=new Keyframe(0,2,0,4,1f/3,weight);a.weightedMode=WeightedMode.Out;var b=new Keyframe(1,3,-2,0,.7f,1f/3);b.weightedMode=WeightedMode.In;var c=new AnimationCurve(a,b);curves.Add(new CurveCase{label="weighted-"+weight,values=Enumerable.Range(0,41).Select(i=>c.Evaluate(i/40f)).ToArray()});}
 foreach(var code in new[]{0,1,2,3,4,5,8}){var asset=ScriptableObject.CreateInstance<NatsumeCurveProbe>();asset.curve=AnimationCurve.Linear(0,2,1,6);var so=new SerializedObject(asset);var p=so.FindProperty("curve");p.FindPropertyRelative("m_PreInfinity").intValue=code;p.FindPropertyRelative("m_PostInfinity").intValue=code;so.ApplyModifiedPropertiesWithoutUndo();curves.Add(new CurveCase{label="wrap-"+code,values=new[]{-1.25f,-.25f,0,.25f,1,1.25f,2.25f}.Select(t=>asset.curve.Evaluate(t)).ToArray()});UnityEngine.Object.DestroyImmediate(asset);}
 var g=new Gradient();g.SetKeys(new[]{new GradientColorKey(Color.red,0),new GradientColorKey(Color.blue,1)},new[]{new GradientAlphaKey(.2f,0),new GradientAlphaKey(.8f,1)});g.mode=GradientMode.PerceptualBlend;var output=new Output{unityVersion=Application.unityVersion,renderChecks=renderChecks.ToArray(),cases=cases.ToArray(),curves=curves.ToArray(),gradient=Enumerable.Range(0,5).Select(i=>g.Evaluate(i/4f)).ToArray()};var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
