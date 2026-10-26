using System;using System.IO;using System.Collections.Generic;using UnityEditor;using UnityEngine;
public static class NatsumeTrailFoldProbe {
 [Serializable]public class Case{public float shift,width,spacing,ratio;public bool sizeWidth;public Vector3[] vertices;public Vector4[] tangents;}
 [Serializable]public class Result{public List<Case> cases=new List<Case>();}
 public static Case[] Measure(Camera cam){var result=new Result();
 foreach(float spacing in new[]{.15f,.3f})foreach(float ratio in new[]{0f,1f})foreach(float width in new[]{.25f,1f,2f})foreach(bool sizeWidth in new[]{false,true})for(int n=0;n<=40;n++){float shift=n*.025f;var go=new GameObject("static");var p=go.AddComponent<ParticleSystem>();p.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);var m=p.main;m.loop=false;m.startLifetime=1;m.startSpeed=0;m.startSize=2;m.playOnAwake=false;var em=p.emission;em.enabled=false;var shape=p.shape;shape.enabled=false;var t=p.trails;t.enabled=true;t.ratio=ratio;t.mode=ParticleSystemTrailMode.Ribbon;t.ribbonCount=2;t.attachRibbonsToTransform=true;t.sizeAffectsWidth=sizeWidth;t.generateLightingData=true;t.widthOverTrail=new ParticleSystem.MinMaxCurve(width,AnimationCurve.Linear(0,.5f,1,1.5f));
 p.Simulate(0,false,true,false);for(int i=0;i<5;i++){var ep=new ParticleSystem.EmitParams();ep.position=new Vector3(i*spacing+shift,(i%2)*.2f,0);ep.velocity=Vector3.zero;p.Emit(ep,1);}var r=p.GetComponent<ParticleSystemRenderer>();var mesh=new Mesh();r.BakeTrailsMesh(mesh,cam,true);result.cases.Add(new Case{spacing=spacing,ratio=ratio,shift=shift,width=width,sizeWidth=sizeWidth,vertices=mesh.vertices,tangents=mesh.tangents});UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(go);}
 return result.cases.ToArray();
 }
}
