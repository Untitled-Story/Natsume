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
    [Serializable] public class Output { public string unityVersion; public Sample[] cases; }
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
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/meshes"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
                unityVersion = Application.unityVersion, cases = cases.ToArray()
            }, true));
        } finally {
            foreach (var mesh in meshes) UnityEngine.Object.DestroyImmediate(mesh);
            UnityEngine.Object.DestroyImmediate(go); UnityEngine.Object.DestroyImmediate(cameraObject);
        }
    }
}
