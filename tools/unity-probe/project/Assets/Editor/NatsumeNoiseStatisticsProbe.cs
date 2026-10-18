using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

// Fixed spatial population; compare distributions, never seeded particle paths.
public static class NatsumeNoiseStatisticsProbe
{
    const int Count = 512;
    [Serializable] public class Sample { public int frame; public double displacementRms, rotationRms, sizeDeltaRms; }
    [Serializable] public class Case { public string label; public uint seed; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public int count = Count; public uint pointSeed = 1234567; public Case[] cases; }
    static Vector3[] Origins()
    {
        uint state = 1234567;
        var values = new float[Count * 3];
        for (int i = 0; i < values.Length; i++) {
            state = unchecked(state * 1664525 + 1013904223);
            values[i] = (state >> 8) * (32f / 16777216f) - 16;
        }
        var points = new Vector3[Count];
        for (int i = 0; i < Count; i++) points[i] = new Vector3(values[i*3], values[i*3+1], values[i*3+2]);
        return points;
    }
    static Case Measure(string label, uint seed, Camera camera)
    {
        var go = new GameObject(label);
        try {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed = false; ps.randomSeed = seed;
            var m = ps.main; m.playOnAwake = false; m.maxParticles = Count;
            m.startRotation3D = true; m.gravityModifier = 0;
            m.simulationSpace = ParticleSystemSimulationSpace.Local; m.scalingMode = ParticleSystemScalingMode.Local;
            var emission = ps.emission; emission.enabled = false;
            var shape = ps.shape; shape.enabled = false;
            var n = ps.noise; n.enabled = true; n.strength = label == "calibrated-high" ? 0.03f : 1;
            n.frequency = label == "frequency-zero" ? 0 : 0.28f; n.damping = true;
            n.quality = label == "low" ? ParticleSystemNoiseQuality.Low : label == "medium" ? ParticleSystemNoiseQuality.Medium : ParticleSystemNoiseQuality.High;
            n.scrollSpeed = label == "scroll" ? 1 : 0;
            n.octaveCount = label == "octaves" ? 3 : 1; n.octaveMultiplier = 0.5f; n.octaveScale = 2;
            n.positionAmount = label == "rotation" || label == "size" ? 0 : 1;
            n.rotationAmount = label == "rotation" ? 1 : 0; n.sizeAmount = label == "size" ? 1 : 0;
            var r = ps.GetComponent<ParticleSystemRenderer>(); r.alignment = ParticleSystemRenderSpace.World; r.maxParticleSize = 100;
            ps.Simulate(0, false, true, false);
            var origins = Origins(); var particles = new ParticleSystem.Particle[Count];
            for (int i = 0; i < Count; i++) particles[i] = new ParticleSystem.Particle {
                position = origins[i], velocity = Vector3.zero, startSize3D = Vector3.one,
                startLifetime = 10, remainingLifetime = 10, startColor = Color.white, randomSeed = (uint)(1000+i)
            };
            ps.SetParticles(particles, Count);
            var samples = new List<Sample>();
            for (int frame = 1; frame <= 60; frame++) {
                ps.Simulate(1f/60f, false, false, false);
                if (frame != 1 && frame != 60) continue;
                if (ps.GetParticles(particles) != Count) throw new Exception("Noise population changed");
                double position = 0, rotation = 0, size = 0;
                for (int i = 0; i < Count; i++) {
                    position += (particles[i].position-origins[i]).sqrMagnitude;
                    rotation += particles[i].rotation3D.sqrMagnitude;
                }
                if (label == "size") {
                    var mesh = new Mesh(); r.BakeMesh(mesh, camera, false);
                    var vertices = mesh.vertices;
                    if (vertices.Length != Count*4) throw new Exception("Unexpected baked vertex count");
                    for (int i = 0; i < Count; i++) {
                        var min = vertices[i*4]; var max = min;
                        for (int j=1;j<4;j++) {min=Vector3.Min(min,vertices[i*4+j]);max=Vector3.Max(max,vertices[i*4+j]);}
                        var delta = max-min-Vector3.one;
                        size += delta.x*delta.x + delta.y*delta.y;
                    }
                    UnityEngine.Object.DestroyImmediate(mesh);
                }
                samples.Add(new Sample {frame=frame, displacementRms=Math.Sqrt(position/Count), rotationRms=Math.Sqrt(rotation/Count), sizeDeltaRms=Math.Sqrt(size/Count)});
            }
            return new Case {label=label,seed=seed,samples=samples.ToArray()};
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        var cameraObject = new GameObject("Noise size camera"); var camera = cameraObject.AddComponent<Camera>();
        camera.orthographic = true; camera.orthographicSize = 100; camera.transform.position = new Vector3(0,0,-100);
        try {
            var cases = new List<Case>();
            foreach (uint seed in new uint[] {2, 4294967295})
                foreach (string label in new [] {"calibrated-high","high","low","medium","scroll","octaves","frequency-zero","rotation","size"})
                    cases.Add(Measure(label,seed,camera));
            var output = new Output {unityVersion=Application.unityVersion,cases=cases.ToArray()};
            var directory = Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/noise-statistics"));
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));
        } catch(Exception error) {Debug.LogException(error);EditorApplication.Exit(1);}
        finally { UnityEngine.Object.DestroyImmediate(cameraObject); }
    }
}
