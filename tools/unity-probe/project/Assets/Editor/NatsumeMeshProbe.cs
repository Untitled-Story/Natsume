using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeMeshProbe
{
    [Serializable] public class Sample {
        public string label; public float[] weights; public int[] counts; public int distribution; public int[] rowCounts; public int changedRows;
        public int particles; public int wrongRows; public int changedMeshes;
    }
    [Serializable] public class MaterialSample { public string label; public int[] pixels; }
    [Serializable] public class Output { public string unityVersion; public Sample[] cases; public MaterialSample[] materialCases; public bool multipleSubmeshesRejected; }
    static MaterialSample[] Materials(Camera camera) {
        var go = new GameObject("Material particles");var ps=go.AddComponent<ParticleSystem>();
        ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
        var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.maxParticles=8;main.startLifetime=10;
        var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;
        var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.renderMode=ParticleSystemRenderMode.Mesh;
        renderer.alignment=ParticleSystemRenderSpace.World;renderer.enableGPUInstancing=false;
        renderer.maxParticleSize=100;

        var mesh = new Mesh();
        mesh.vertices = new [] {new Vector3(-2,-1,0),new Vector3(0,-1,0),new Vector3(0,1,0),new Vector3(-2,1,0),
            new Vector3(0,-1,0),new Vector3(2,-1,0),new Vector3(2,1,0),new Vector3(0,1,0)};
        mesh.uv = Enumerable.Repeat(Vector2.zero, 8).ToArray();
        mesh.subMeshCount = 2; mesh.SetTriangles(new[]{0,1,2,0,2,3},0); mesh.SetTriangles(new[]{4,5,6,4,6,7},1);
        mesh.colors32=Enumerable.Repeat(new Color32(255,255,255,255),8).ToArray();mesh.RecalculateBounds();mesh.RecalculateNormals();
        var shader = Shader.Find("Hidden/Internal-Colored");
        if (!shader) throw new Exception("Missing probe shader");
        var materials = new [] {Color.red, Color.green, Color.blue, Color.yellow}.Select(c => new Material(shader) {color=c}).ToArray();
        foreach(var material in materials) {material.SetInt("_Cull",0);material.SetInt("_ZWrite",0);material.SetInt("_SrcBlend",5);material.SetInt("_DstBlend",10);material.SetInt("_ZTest",8);}
        var rt = new RenderTexture(64,64,24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
        var image = new Texture2D(64,64,TextureFormat.RGBA32,false,true);
        var samples = new List<MaterialSample>();
        camera.targetTexture=rt; camera.orthographicSize=2; camera.aspect=1;
        camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=Color.black;
        var sheet = ps.textureSheetAnimation; sheet.enabled=false;
        mesh.subMeshCount=1;mesh.SetTriangles(new[]{0,1,2,0,2,3,4,5,6,4,6,7},0);
        renderer.SetMeshes(new[]{mesh}); renderer.SetMeshWeightings(new[]{1f});
        renderer.meshDistribution=ParticleSystemMeshDistribution.UniformRandom;
        renderer.sortMode=ParticleSystemSortMode.None;
        renderer.localBounds=new Bounds(Vector3.zero,new Vector3(100,100,100));
        var particles = new [] {new ParticleSystem.Particle {position=Vector3.zero,startSize=1,startColor=Color.white,startLifetime=10,remainingLifetime=10,randomSeed=1}};
        ps.Simulate(0,false,true,false);ps.SetParticles(particles,1);
        try {
            foreach (var mode in new [] {ParticleSystemRenderMode.Mesh,ParticleSystemRenderMode.Billboard}) {
                renderer.renderMode=mode;
                foreach (var slots in new [] {new[]{0},new[]{0,1},new[]{0,1,2},new[]{0,1,2,3},new[]{-1,1},new[]{0,-1},new[]{-1,1,2}}) {
                    renderer.sharedMaterials=slots.Select(i=>i<0?null:materials[i]).ToArray();
                    ps.Simulate(.001f,false,false,false);
                    camera.Render(); RenderTexture.active=rt; image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();
                    samples.Add(new MaterialSample {label=mode+"-"+string.Join("-",slots),pixels=new[]{16,32,48}.SelectMany(x=>{
                        var c=image.GetPixel(x,32);return new[]{Mathf.RoundToInt(c.r*255),Mathf.RoundToInt(c.g*255),Mathf.RoundToInt(c.b*255)};
                    }).ToArray()});
                }
            }
            // Two overlapping particles distinguish material-major from per-particle passes.
            renderer.renderMode=ParticleSystemRenderMode.Mesh;
            mesh.subMeshCount=1;mesh.SetTriangles(new[]{0,1,2,0,2,3,4,5,6,4,6,7},0);
            materials[0].color=new Color(1,0,0,.5f);materials[2].color=new Color(0,0,1,.5f);
            renderer.sharedMaterials=new[]{materials[0],materials[1],materials[2]}; ps.SetParticles(new[]{particles[0],particles[0]},2);
            camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,64,64),0,0);image.Apply();
            var pixel=image.GetPixel(16,32);
            samples.Add(new MaterialSample {label="Mesh-transparent-order",pixels=new[]{Mathf.RoundToInt(pixel.r*255),Mathf.RoundToInt(pixel.g*255),Mathf.RoundToInt(pixel.b*255)}});
            return samples.ToArray();
        } finally {
            camera.targetTexture=null;RenderTexture.active=null;
            UnityEngine.Object.DestroyImmediate(go);
            foreach(var material in materials) UnityEngine.Object.DestroyImmediate(material);
            UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(image);UnityEngine.Object.DestroyImmediate(mesh);
        }
    }
    static bool RejectMultipleSubmeshes(Camera camera) {
        bool rejected=false;
        Application.LogCallback handler=(message,stack,type)=>{if(message.Contains("exactly one (1) sub mesh"))rejected=true;};
        Application.logMessageReceived+=handler;
        var go=new GameObject("Rejected geometry");var ps=go.AddComponent<ParticleSystem>();
        var mesh=MakeMesh(0);mesh.subMeshCount=2;mesh.SetTriangles(new[]{0,1,2},1);
        var material=new Material(Shader.Find("Hidden/Internal-Colored"));
        try {
            ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
            var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.renderMode=ParticleSystemRenderMode.Mesh;
            renderer.sharedMaterial=material;renderer.mesh=mesh;
            ps.Simulate(0,false,true,false);ps.SetParticles(new[]{new ParticleSystem.Particle{startSize=1,startLifetime=10,remainingLifetime=10,startColor=Color.white}},1);
            camera.Render();return rejected;
        } finally {
            UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(material);
            Application.logMessageReceived-=handler;
        }
    }
    static Mesh MakeMesh(int index) {
        var mesh = new Mesh();
        float w = index + 1;
        mesh.vertices = new [] { new Vector3(-w/2, -.5f, 0), new Vector3(w/2, -.5f, 0), new Vector3(0, .5f, 0) };
        mesh.uv = new [] { Vector2.zero, Vector2.right, Vector2.up };
        mesh.triangles = new [] { 0, 1, 2 };
        return mesh;
    }
    static int[] Read(ParticleSystemRenderer renderer, Camera camera, int count, out int wrongRows, out int[] selectedRows) {
        var baked = new Mesh(); renderer.BakeMesh(baked, camera, false);
        var min = Enumerable.Repeat(float.PositiveInfinity, count).ToArray();
        var max = Enumerable.Repeat(float.NegativeInfinity, count).ToArray();
        var rows = Enumerable.Repeat(float.PositiveInfinity, count).ToArray();
        var vertices = baked.vertices; var uv = baked.uv;
        for (int j = 0; j < vertices.Length; j++) {
            int i = Mathf.RoundToInt(vertices[j].x / 10);
            if (i < 0 || i >= count) continue;
            min[i] = Mathf.Min(min[i], vertices[j].x); max[i] = Mathf.Max(max[i], vertices[j].x);
            rows[i] = Mathf.Min(rows[i], uv[j].y);
        }
        var result = min.Select((x, i) => Mathf.RoundToInt(max[i] - x) - 1).ToArray();
        selectedRows = rows.Select(y => 2 - Mathf.RoundToInt(y * 3)).ToArray();
        wrongRows = result.Where((m, i) => m < 0 || m > 2 || Mathf.Abs(rows[i] - (2 - m) / 3f) > .0001f).Count();
        UnityEngine.Object.DestroyImmediate(baked); return result;
    }
    public static void Run() {
        var cameraObject = new GameObject("Mesh camera"); var camera = cameraObject.AddComponent<Camera>();
        camera.orthographic = true; camera.orthographicSize = 50000;
        camera.transform.position = new Vector3(0, 0, -10);
        var go = new GameObject("Mesh particles"); var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main; main.playOnAwake = false; main.maxParticles = 8192;
        var emission = ps.emission; emission.enabled = false; var shape = ps.shape; shape.enabled = false;
        var renderer = ps.GetComponent<ParticleSystemRenderer>(); renderer.renderMode = ParticleSystemRenderMode.Mesh;
        renderer.alignment = ParticleSystemRenderSpace.World; renderer.maxParticleSize = 1;
        var meshes = Enumerable.Range(0, 3).Select(MakeMesh).ToArray(); renderer.SetMeshes(meshes);
        var sheet = ps.textureSheetAnimation; sheet.enabled = true; sheet.numTilesX = 1; sheet.numTilesY = 3;
        sheet.animation = ParticleSystemAnimationType.SingleRow; sheet.rowMode = ParticleSystemAnimationRowMode.MeshIndex;
        sheet.frameOverTime = 0; sheet.startFrame = 0;
        var cases = new List<Sample>();
        try {
            int[] uniformRows = null;
            foreach (var distribution in new [] {ParticleSystemMeshDistribution.UniformRandom, ParticleSystemMeshDistribution.NonUniformRandom})
            foreach (var weights in new [] { new float[] {1,1,1}, new float[] {1,3,6}, new float[] {0,1,0}, new float[] {0,0,0} }) {
                renderer.meshDistribution = distribution;
                renderer.SetMeshWeightings(weights);
                var particles = new ParticleSystem.Particle[8192];
                for (int i = 0; i < particles.Length; i++) particles[i] = new ParticleSystem.Particle {
                    position = new Vector3(i * 10, 0, 0), startSize = 1, startColor = Color.white,
                    startLifetime = 10, remainingLifetime = 10, randomSeed = (uint)(i + 1)
                };
                ps.Simulate(0, false, true, false); ps.SetParticles(particles, particles.Length);
                int wrong; int[] firstRows; var first = Read(renderer, camera, particles.Length, out wrong, out firstRows);
                if (uniformRows == null) uniformRows = firstRows;
                ps.Simulate(.1f, false, false, false);
                int ignored; int[] nextRows; var next = Read(renderer, camera, particles.Length, out ignored, out nextRows);
                cases.Add(new Sample { label = distribution + "-" + string.Join("-", weights), weights = weights, distribution = (int)distribution,
                    rowCounts = Enumerable.Range(0, 3).Select(m => firstRows.Count(x => x == m)).ToArray(),
                    changedRows = firstRows.Where((r, i) => r != uniformRows[i] || r != nextRows[i]).Count(),
                    counts = Enumerable.Range(0, 3).Select(m => first.Count(x => x == m)).ToArray(),
                    particles = particles.Length, wrongRows = wrong,
                    changedMeshes = first.Where((m, i) => m != next[i]).Count() });
            }
            go.SetActive(false);
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/meshes"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
                unityVersion = Application.unityVersion, cases = cases.ToArray(), materialCases = Materials(camera), multipleSubmeshesRejected=RejectMultipleSubmeshes(camera)
            }, true));
        } finally {
            foreach (var mesh in meshes) UnityEngine.Object.DestroyImmediate(mesh);
            UnityEngine.Object.DestroyImmediate(go); UnityEngine.Object.DestroyImmediate(cameraObject);
        }
    }
}
