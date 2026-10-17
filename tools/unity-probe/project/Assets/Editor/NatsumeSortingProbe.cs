using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class NatsumeSortingProbe
{
    [Serializable] public class Case { public string label; public int[] order; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    public static void Run()
    {
        var cameraObject = new GameObject("Sorting camera");
        var camera = cameraObject.AddComponent<Camera>();
        camera.orthographic = true;
        camera.transform.position = new Vector3(0, 0, -10);
        var go = new GameObject("Sorting particles");
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main;
        main.playOnAwake = false;
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        var emission = ps.emission; emission.enabled = false;
        var shape = ps.shape; shape.enabled = false;
        var renderer = ps.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        renderer.alignment = ParticleSystemRenderSpace.View;
        renderer.maxParticleSize = 100;
        var particles = new ParticleSystem.Particle[3];
        float[] depth = { 3, 1, 2 }, age = { 0.2f, 0.8f, 0.5f };
        for (int i = 0; i < 3; i++) particles[i] = new ParticleSystem.Particle {
            position = new Vector3(i * 100, 0, depth[i]), startLifetime = 1,
            remainingLifetime = 1 - age[i], startSize = 1,
            startColor = new Color32((byte)(i + 1), 0, 0, 255), randomSeed = (uint)(i + 1)
        };
        ps.Simulate(0, false, true, false);
        ps.SetParticles(particles, 3);
        var modes = new [] { ParticleSystemSortMode.None, ParticleSystemSortMode.Distance,
            ParticleSystemSortMode.OldestInFront, ParticleSystemSortMode.YoungestInFront, ParticleSystemSortMode.Depth };
        try {
            var cases = modes.Select(mode => {
                renderer.sortMode = mode;
                var mesh = new Mesh();
                renderer.BakeMesh(mesh, camera, false);
                var indices = mesh.triangles;
                var colors = mesh.colors32;
                var order = Enumerable.Range(0, indices.Length / 6).Select(i => (int)colors[indices[i * 6]].r - 1).ToArray();
                UnityEngine.Object.DestroyImmediate(mesh);
                return new Case { label = mode.ToString(), order = order };
            }).ToArray();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/sorting"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
                unityVersion = Application.unityVersion, cases = cases
            }, true));
        } finally {
            UnityEngine.Object.DestroyImmediate(go);
            UnityEngine.Object.DestroyImmediate(cameraObject);
        }
    }
}
