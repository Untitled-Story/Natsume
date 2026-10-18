using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

// Fixed spatial population; Low also exposes first-step positions for field checks.
public static class NatsumeNoiseStatisticsProbe
{
    static int Count = 512;
    [Serializable] public class Input { public int count = 512; public Case[] cases; }
    [Serializable] public class Sample { public int frame; public double displacementRms, rotationRms, sizeDeltaRms; public Vector3[] positions; }
    [Serializable] public class Case {
        public string label; public uint seed, pointSeed;
        public int quality = 2, octaves = 1;
        public float frequency = 0.28f, strength = 1, scroll, multiplier = 0.5f, scale = 2;
        public bool damping = true;
        public Sample[] samples;
    }
    [Serializable] public class Output { public string unityVersion; public int count = Count; public uint pointSeed = 1234567; public Case[] cases; }
    static Vector3[] Origins(uint pointSeed)
    {
        uint state = pointSeed;
        var values = new float[Count * 3];
        for (int i = 0; i < values.Length; i++) {
            state = unchecked(state * 1664525 + 1013904223);
            values[i] = (state >> 8) * (32f / 16777216f) - 16;
        }
        var points = new Vector3[Count];
        for (int i = 0; i < Count; i++) points[i] = new Vector3(values[i*3], values[i*3+1], values[i*3+2]);
        return points;
    }
    static Case Measure(Case config, Camera camera)
    {
        string label=config.label; uint seed=config.seed;
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
            var n = ps.noise; n.enabled = true; n.strength = config.strength;
            n.frequency = config.frequency; n.damping = config.damping;
            n.quality = (ParticleSystemNoiseQuality)config.quality;
            n.scrollSpeed = config.scroll;
            n.octaveCount = config.octaves; n.octaveMultiplier = config.multiplier; n.octaveScale = config.scale;
            n.positionAmount = label == "rotation" || label == "size" ? 0 : 1;
            n.rotationAmount = label == "rotation" ? 1 : 0; n.sizeAmount = label == "size" ? 1 : 0;
            var r = ps.GetComponent<ParticleSystemRenderer>(); r.alignment = ParticleSystemRenderSpace.World; r.maxParticleSize = 100;
            ps.Simulate(0, false, true, false);
            var origins = Origins(config.pointSeed); var particles = new ParticleSystem.Particle[Count];
            for (int i = 0; i < Count; i++) particles[i] = new ParticleSystem.Particle {
                position = origins[i], velocity = Vector3.zero, startSize3D = Vector3.one,
                startLifetime = 10, remainingLifetime = 10, startColor = Color.white, randomSeed = (uint)(1000+i)
            };
            ps.SetParticles(particles, Count);
            var samples = new List<Sample>();
            for (int frame = 1; frame <= 60; frame++) {
                ps.Simulate(1f/60f, false, false, false);
                if (frame != 1 && frame != 15 && frame != 60) continue;
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
                Vector3[] fieldPositions = null;
                if (config.quality == 0 && config.scroll == 0 && frame == 1) {
                    fieldPositions = new Vector3[Math.Min(8, Count)];
                    for (int i = 0; i < fieldPositions.Length; i++) fieldPositions[i] = particles[i].position;
                }
                samples.Add(new Sample {frame=frame, displacementRms=Math.Sqrt(position/Count), rotationRms=Math.Sqrt(rotation/Count), sizeDeltaRms=Math.Sqrt(size/Count), positions=fieldPositions});
            }
            config.samples=samples.ToArray(); return config;
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        var cameraObject = new GameObject("Noise size camera"); var camera = cameraObject.AddComponent<Camera>();
        camera.orthographic = true; camera.orthographicSize = 100; camera.transform.position = new Vector3(0,0,-100);
        try {
            var cases = new List<Case>();
            var inputPath = Environment.GetEnvironmentVariable("NATSUME_NOISE_STATISTICS_INPUT");
            if (!string.IsNullOrEmpty(inputPath)) {
                var input = JsonUtility.FromJson<Input>(File.ReadAllText(inputPath));
                if (input.count < 1 || input.count > 65536 || input.cases == null || input.cases.Length == 0)
                    throw new Exception("Invalid Noise statistics input");
                Count = input.count;
                foreach (var config in input.cases) cases.Add(Measure(config, camera));
            } else {
            foreach (uint seed in new uint[] {2, 4294967295})
                foreach (string label in new [] {"calibrated-high","high","low","medium","scroll","octaves","frequency-zero","rotation","size"})
                    cases.Add(Measure(new Case {
                        label=label,seed=seed,pointSeed=1234567,
                        quality=label=="low"?0:label=="medium"?1:2,
                        frequency=label=="frequency-zero"?0:0.28f,
                        strength=label=="calibrated-high"?0.03f:1,
                        scroll=label=="scroll"?1:0,octaves=label=="octaves"?3:1
                    },camera));
            foreach (uint seed in new uint[] {12345,98765,13579,24680}) {
                foreach (int quality in new [] {0,1,2})
                    foreach (float frequency in new [] {0.1f,0.28f,1f})
                        cases.Add(Measure(new Case {label="quality-"+quality+"-frequency-"+frequency.ToString(System.Globalization.CultureInfo.InvariantCulture),seed=seed,pointSeed=seed+1234567,quality=quality,frequency=frequency},camera));
                foreach (float speed in new [] {0.25f,2f,-1f})
                    cases.Add(Measure(new Case {label="scroll-"+speed.ToString(System.Globalization.CultureInfo.InvariantCulture),seed=seed,pointSeed=seed+1234567,scroll=speed},camera));
                cases.Add(Measure(new Case {label="octaves-two",seed=seed,pointSeed=seed+1234567,octaves=2},camera));
                cases.Add(Measure(new Case {label="octaves-four",seed=seed,pointSeed=seed+1234567,octaves=4,multiplier=0.3f,scale=1.7f},camera));
                cases.Add(Measure(new Case {label="low-scroll",seed=seed,pointSeed=seed+1234567,quality=0,scroll=1},camera));
                cases.Add(Measure(new Case {label="medium-octaves",seed=seed,pointSeed=seed+1234567,quality=1,octaves=3},camera));
                cases.Add(Measure(new Case {label="scroll-weak",seed=seed,pointSeed=seed+1234567,scroll=1,strength=0.1f},camera));
            }
            }
            var output = new Output {unityVersion=Application.unityVersion,cases=cases.ToArray()};
            var directory = Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/noise-statistics"));
            Directory.CreateDirectory(directory);
            var outputPath = Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT") ?? Path.Combine(directory,"unity-2022.3.21f1.json");
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            File.WriteAllText(outputPath,JsonUtility.ToJson(output,true));
        } catch(Exception error) {Debug.LogException(error);EditorApplication.Exit(1);}
        finally { UnityEngine.Object.DestroyImmediate(cameraObject); }
    }
}
