using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;

/** Checks Ribbon parent grouping after parent and child deaths. */
public static class NatsumeTrailGroupProbe {
    [Serializable] public class Case {
        public bool split, attach, parentDead, childDead;
        public int ribbons;
        public Vector3[] particles, vertices;
        public int[] indices; public Vector3[] candidateVertices; public int[] candidateIndices; public int livePixels,bakedPixels,pixelMismatches,candidatePixels,candidateMismatches;
    }
    [Serializable] public class Candidate {public Vector3[] vertices;public int[] indices;}
    [Serializable] public class Candidates {public Candidate[] cases;}
    public static Case[] Measure(Camera camera) {
        var rows = new List<Case>();
        var candidatePath=Environment.GetEnvironmentVariable("NATSUME_TRAIL_CANDIDATES");
        var candidates=String.IsNullOrEmpty(candidatePath)?null:JsonUtility.FromJson<Candidates>(File.ReadAllText(candidatePath));
        camera.orthographic=true; camera.transform.position=new Vector3(0,0,-10); camera.transform.rotation=Quaternion.identity;
        foreach(bool split in new[]{false,true}) foreach(bool attach in new[]{false,true}) foreach(int ribbons in new[]{1,2}) foreach(int death in new[]{0,1,2}) {
            var root=new GameObject("parent");var child=new GameObject("child");var mesh=new Mesh();
            try {
                var parent=root.AddComponent<ParticleSystem>();var p=child.AddComponent<ParticleSystem>();
                foreach(var ps in new[]{parent,p}) {
                    ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.startSpeed=0;m.startLifetime=2;m.loop=false;
                    var e=ps.emission;e.enabled=false;var sh=ps.shape;sh.enabled=false;
                }
                var main=parent.main;main.startLifetime=.1f;
                var em=p.emission;em.SetBursts(new[]{new ParticleSystem.Burst(0,3)});
                var sub=parent.subEmitters;sub.enabled=true;sub.AddSubEmitter(p,ParticleSystemSubEmitterType.Birth,ParticleSystemSubEmitterProperties.InheritNothing);
                var t=p.trails;t.enabled=true;t.mode=ParticleSystemTrailMode.Ribbon;t.ribbonCount=ribbons;t.splitSubEmitterRibbons=split;t.attachRibbonsToTransform=attach;t.widthOverTrail=.25f;t.sizeAffectsWidth=false;
                parent.Simulate(0,true,true,false);
                for(int i=0;i<2;i++) {var ep=new ParticleSystem.EmitParams();ep.position=new Vector3(i*3,0,0);ep.randomSeed=(uint)(i+1);parent.Emit(ep,1);}
                parent.Simulate(.01f,true,false,false);
                var particles=new ParticleSystem.Particle[p.particleCount];p.GetParticles(particles);
                for(int i=0;i<particles.Length;i++) {particles[i].position=new Vector3(i*.4f,(i%2)*.2f,0);particles[i].velocity=Vector3.zero;}
                p.SetParticles(particles,particles.Length);
                if(death>0)parent.Simulate(.11f,true,false,false);
                if(death==2) {p.GetParticles(particles);particles[1].remainingLifetime=-1;p.SetParticles(particles,particles.Length);parent.Simulate(.001f,true,false,false);}
                particles=new ParticleSystem.Particle[p.particleCount];p.GetParticles(particles);
                var positions=new Vector3[particles.Length];for(int i=0;i<particles.Length;i++)positions[i]=particles[i].position;
                var material=new Material(Shader.Find("Particles/Standard Unlit"));material.SetColor("_Color",Color.green);material.SetInt("_Cull",0);
                var renderer=p.GetComponent<ParticleSystemRenderer>();renderer.trailMaterial=material;
                renderer.SetActiveTrailVertexStreams(new List<ParticleSystemVertexStream>{ParticleSystemVertexStream.Position,ParticleSystemVertexStream.Color,ParticleSystemVertexStream.UV});
                camera.transform.position=new Vector3(1,0,-10);camera.orthographicSize=1.4f;
                var target=new RenderTexture(128,128,24);target.Create();camera.targetTexture=target;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;
                var image=new Texture2D(128,128,TextureFormat.RGBA32,false);
                Color32[] live,baked;
                renderer.BakeTrailsMesh(mesh,camera,true);
                var capturedVertices=mesh.vertices;var capturedIndices=mesh.triangles;
                var snapshot=new Mesh();snapshot.vertices=capturedVertices;snapshot.triangles=capturedIndices;renderer.renderMode=ParticleSystemRenderMode.None;
                camera.Render();RenderTexture.active=target;image.ReadPixels(new Rect(0,0,128,128),0,0);image.Apply();live=image.GetPixels32();
                renderer.enabled=false;
                var bakedGo=new GameObject("baked-ribbon");bakedGo.AddComponent<MeshFilter>().sharedMesh=snapshot;bakedGo.AddComponent<MeshRenderer>().sharedMaterial=material;
                camera.Render();RenderTexture.active=target;image.ReadPixels(new Rect(0,0,128,128),0,0);image.Apply();baked=image.GetPixels32();
                int liveCount=0,bakedCount=0,mismatches=0;for(int i=0;i<live.Length;i++){bool a=live[i].g>100,b=baked[i].g>100;if(a)liveCount++;if(b)bakedCount++;if(a!=b)mismatches++;}
                int candidateCount=0,candidateMismatches=0;
                if(candidates!=null) {
                    var candidate=candidates.cases[rows.Count];snapshot.Clear();snapshot.vertices=candidate.vertices;snapshot.triangles=candidate.indices;snapshot.RecalculateBounds();
                    camera.Render();RenderTexture.active=target;image.ReadPixels(new Rect(0,0,128,128),0,0);image.Apply();var candidateColors=image.GetPixels32();
                    for(int i=0;i<live.Length;i++){bool a=live[i].g>100,b=candidateColors[i].g>100;if(b)candidateCount++;if(a!=b)candidateMismatches++;}
                }
                camera.targetTexture=null;RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(bakedGo);UnityEngine.Object.DestroyImmediate(snapshot);UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(image);UnityEngine.Object.DestroyImmediate(material);
                rows.Add(new Case{candidatePixels=candidateCount,candidateMismatches=candidateMismatches,candidateVertices=candidates==null?null:candidates.cases[rows.Count].vertices,candidateIndices=candidates==null?null:candidates.cases[rows.Count].indices,livePixels=liveCount,bakedPixels=bakedCount,pixelMismatches=mismatches,split=split,attach=attach,ribbons=ribbons,parentDead=death>0,childDead=death==2,particles=positions,vertices=capturedVertices,indices=capturedIndices});
            } finally {UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(child);}
        }
        return rows.ToArray();
    }
}
