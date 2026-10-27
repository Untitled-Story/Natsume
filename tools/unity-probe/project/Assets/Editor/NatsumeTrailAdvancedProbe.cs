using System;
using System.Collections.Generic;
using UnityEngine;

/** Independent Ribbon width and view checks, with authored particles instead of random emission. */
public static class NatsumeTrailAdvancedProbe
{
    [Serializable] public class Case {
        public Vector3 view;
        public int layout, sizes;
        public float width;
        public Vector3[] centers, vertices, normals;
        public float[] particleSizes;
        public Vector4[] tangents;
        public Vector2[] uv;
        public Color32[] colors;
    }
    [Serializable] public class MotionCase {
        public Vector3 view;
        public bool die;
        public float width;
        public int frame;
        public Vector3[] vertices;
        public Vector2[] uv;
        public Color32[] colors;
    }
    public static MotionCase[] MeasureMotion(Camera camera) {
        var result = new List<MotionCase>();
        foreach(var view in new[]{new Vector3(0,0,-10),new Vector3(-3,4,-6),new Vector3(4,-2,-3)}) foreach(float width in new[]{.25f,1f}) foreach(bool die in new[]{false,true}) {
            var go=new GameObject("trail-perspective-motion");var mesh=new Mesh();
            try {
                var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                var m=ps.main;m.playOnAwake=false;m.loop=false;m.startLifetime=.5f;m.startSpeed=0;m.startSize=1;
                var e=ps.emission;e.enabled=false;var shape=ps.shape;shape.enabled=false;
                var t=ps.trails;t.enabled=true;t.lifetime=1;t.minVertexDistance=.01f;t.sizeAffectsWidth=false;t.widthOverTrail=width;t.dieWithParticles=die;
                t.colorOverLifetime=new ParticleSystem.MinMaxGradient(Gradient(Color.red,Color.blue));
                t.colorOverTrail=new ParticleSystem.MinMaxGradient(Gradient(Color.white,new Color(.5f,1,.5f,.5f)));
                ps.Simulate(0,false,true,false);var ep=new ParticleSystem.EmitParams();ep.position=Vector3.zero;ep.velocity=new Vector3(1,.5f,.75f);ps.Emit(ep,1);
                camera.orthographic=false;camera.transform.position=view;camera.transform.LookAt(Vector3.zero);
                for(int frame=1;frame<=20;frame++) {
                    ps.Simulate(.05f,false,false,false);
                    if(frame==2||frame==6||frame==9||frame==10||frame==11||frame==12||frame==16||frame==20) {
                        ps.GetComponent<ParticleSystemRenderer>().BakeTrailsMesh(mesh,camera,true);
                        result.Add(new MotionCase{view=view,die=die,width=width,frame=frame,vertices=mesh.vertices,uv=mesh.uv,colors=mesh.colors32});
                    }
                }
            }finally{UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(go);}
        }
        return result.ToArray();
    }
    static Gradient Gradient(Color a,Color b) {var g=new Gradient();g.SetKeys(new[]{new GradientColorKey(a,0),new GradientColorKey(b,1)},new[]{new GradientAlphaKey(a.a,0),new GradientAlphaKey(b.a,1)});return g;}
    public static Case[] Measure(Camera camera) {
        var result = new List<Case>();
        var views = new[] { new Vector3(0,0,-10), new Vector3(-3,4,-6), new Vector3(4,-2,-3) };
        foreach(var view in views) foreach(int layout in new[]{0,1,2}) foreach(int sizes in new[]{0,1,2}) foreach(float width in new[]{.25f,1f}) {
            var go = new GameObject("ribbon-width-view"); var mesh = new Mesh();
            try {
                var ps=go.AddComponent<ParticleSystem>(); ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                var m=ps.main; m.playOnAwake=false; m.loop=false; m.startLifetime=2; m.startSpeed=0; m.startSize=1;
                var e=ps.emission; e.enabled=false; var shape=ps.shape; shape.enabled=false;
                var t=ps.trails; t.enabled=true; t.mode=ParticleSystemTrailMode.Ribbon; t.ribbonCount=1;
                t.ratio=1; t.sizeAffectsWidth=true; t.generateLightingData=true; t.widthOverTrail=width;
                ps.Simulate(0,false,true,false);
                var points=new Vector3[5]; var scales=new float[5];
                for(int i=0;i<5;i++) {
                    points[i] = layout==0 ? new Vector3(i*.4f,0,0) : layout==1 ? new Vector3(i*.4f,(i%2)*.3f,i*.15f) : new Vector3(i*.25f,(i%2)*.2f,i*i*.12f);
                    scales[i] = sizes==0 ? 1 : sizes==1 ? new[]{.5f,1.5f,.75f,2f,1f}[i] : new[]{2f,.5f,1.5f,.75f,1f}[i];
                    var ep=new ParticleSystem.EmitParams(); ep.position=points[i]; ep.velocity=Vector3.zero; ep.startSize=scales[i]; ps.Emit(ep,1);
                }
                camera.orthographic=false; camera.transform.position=view; camera.transform.LookAt(Vector3.zero);
                var r=ps.GetComponent<ParticleSystemRenderer>(); r.BakeTrailsMesh(mesh,camera,true);
                result.Add(new Case { view=view,layout=layout,sizes=sizes,width=width,centers=points,particleSizes=scales,vertices=mesh.vertices,normals=mesh.normals,tangents=mesh.tangents,uv=mesh.uv,colors=mesh.colors32 });
            } finally { UnityEngine.Object.DestroyImmediate(mesh); UnityEngine.Object.DestroyImmediate(go); }
        }
        camera.orthographic=true; camera.transform.position=new Vector3(0,0,-10); camera.transform.rotation=Quaternion.identity;
        return result.ToArray();
    }
}
