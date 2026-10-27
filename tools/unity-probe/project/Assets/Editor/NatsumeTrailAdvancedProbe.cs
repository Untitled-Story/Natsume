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
