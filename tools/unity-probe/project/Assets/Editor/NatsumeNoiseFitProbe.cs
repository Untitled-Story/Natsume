using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

// Numerical measurements only; this is not part of the Natsume runtime.
public static class NatsumeNoiseFitProbe
{
    [Serializable] public class Point { public Vector3 position, velocity; public uint seed = 1000; }
    [Serializable] public class Case
    {
        public string label;
        public uint systemSeed = 12345;
        public float strength = 1, frequency = 1, scroll = 0, dt = 1f / 60f;
        public bool damping = false;
        public int quality = 2, octaves = 1, steps = 1, sampleEvery = 1;
        public float octaveMultiplier = 0.5f, octaveScale = 2;
        public Vector3 transformPosition, transformEuler;
        public Vector3 transformScale = Vector3.one;
        public bool noiseEnabled = true, limitEnabled = false, velocityEnabled = false;
        public float limit = 0.12f, dampen = 0.26f;
        public Vector3 orbital, linear;
        public Point[] points;
    }
    [Serializable] public class Input { public Case[] cases; }
    [Serializable] public class Sample { public int frame, index; public Vector3 position, velocity; }
    [Serializable] public class Result { public string label; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Result[] cases; }
    static string DirectoryPath { get { return Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines")); } }

    static Result Measure(Case settings)
    {
        if (settings.points == null || settings.points.Length == 0 || settings.points.Length > 1000000)
            throw new Exception("Invalid point count");
        var go = new GameObject("Natsume noise field measurement");
        try
        {
            go.transform.position = settings.transformPosition;
            go.transform.eulerAngles = settings.transformEuler;
            go.transform.localScale = settings.transformScale;
            var system = go.AddComponent<ParticleSystem>();
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            system.useAutoRandomSeed = false; system.randomSeed = settings.systemSeed;
            var main = system.main;
            main.duration = 100; main.loop = false; main.playOnAwake = false;
            main.startLifetime = 100; main.startSpeed = 0; main.startSize = 1;
            main.gravityModifier = 0; main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.simulationSpeed = 1; main.maxParticles = settings.points.Length;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var emission = system.emission; emission.enabled = false;
            var shape = system.shape; shape.enabled = false;
            go.GetComponent<ParticleSystemRenderer>().enabled = false;
            var noise = system.noise;
            noise.enabled = settings.noiseEnabled; noise.separateAxes = false;
            noise.strength = settings.strength; noise.frequency = settings.frequency;
            noise.damping = settings.damping; noise.quality = (ParticleSystemNoiseQuality)settings.quality;
            noise.octaveCount = settings.octaves; noise.octaveMultiplier = settings.octaveMultiplier; noise.octaveScale = settings.octaveScale;
            noise.scrollSpeed = settings.scroll; noise.remapEnabled = false;
            noise.positionAmount = 1; noise.rotationAmount = 0; noise.sizeAmount = 0;
            var limit = system.limitVelocityOverLifetime;
            limit.enabled = settings.limitEnabled; limit.separateAxes = false;
            limit.limit = settings.limit; limit.dampen = settings.dampen; limit.drag = 0;
            var velocity = system.velocityOverLifetime;
            velocity.enabled = settings.velocityEnabled; velocity.space = ParticleSystemSimulationSpace.Local;
            velocity.x = settings.linear.x; velocity.y = settings.linear.y; velocity.z = settings.linear.z;
            velocity.orbitalX = settings.orbital.x; velocity.orbitalY = settings.orbital.y; velocity.orbitalZ = settings.orbital.z;
            system.Simulate(0, false, true, false);
            var particles = new ParticleSystem.Particle[settings.points.Length];
            for (int i = 0; i < particles.Length; i++)
            {
                var point = settings.points[i];
                particles[i] = new ParticleSystem.Particle {
                    position = point.position, velocity = point.velocity,
                    startLifetime = 100, remainingLifetime = 100, startSize = 1,
                    randomSeed = point.seed, startColor = Color.white
                };
            }
            system.SetParticles(particles, particles.Length);
            var samples = new List<Sample>();
            for (int frame = 0; frame <= settings.steps; frame++)
            {
                if (frame != 0) system.Simulate(settings.dt, false, false, false);
                if (frame % settings.sampleEvery != 0 && frame != settings.steps) continue;
                int count = system.GetParticles(particles);
                if (count != particles.Length) throw new Exception("Particle count changed in " + settings.label);
                for (int i = 0; i < count; i++)
                    samples.Add(new Sample { frame = frame, index = i, position = particles[i].position, velocity = particles[i].velocity });
            }
            return new Result { label = settings.label, samples = samples.ToArray() };
        }
        finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        try
        {
            var input = JsonUtility.FromJson<Input>(File.ReadAllText(Path.Combine(DirectoryPath, "noise-fit-input.json")));
            var output = new Output { unityVersion = Application.unityVersion, cases = new Result[input.cases.Length] };
            for (int i = 0; i < input.cases.Length; i++) output.cases[i] = Measure(input.cases[i]);
            File.WriteAllText(Path.Combine(DirectoryPath, "noise-fit-output.json"), JsonUtility.ToJson(output));
            Debug.Log("NATSUME_NOISE_FIT_COMPLETE");
        }
        catch (Exception exception) { Debug.LogException(exception); EditorApplication.Exit(1); }
    }
}
