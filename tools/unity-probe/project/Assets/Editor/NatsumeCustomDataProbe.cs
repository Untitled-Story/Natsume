using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeCustomDataProbe
{
    [Serializable] public class Sample { public int frame; public float remaining; public Vector4 custom1, custom2; }
    [Serializable] public class Case {
        public string label;
        public int components;
        public float lifetime;
        public bool emitted, gradient;
        public float[] steps;
        public Sample[] samples;
    }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    static Case Measure(int components, bool emitted = false, bool gradient = false, float lifetime = 1)
    {
        string label = gradient ? (emitted ? "birth" : "manual") + "-variable-" + lifetime : "vector-" + components;
        var go = new GameObject(label);
        try {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.playOnAwake = false; main.loop = false; main.startLifetime = lifetime;
            main.startSpeed = 0; main.simulationSpace = ParticleSystemSimulationSpace.Local;
            var shape = ps.shape; shape.enabled = false;
            var emission = ps.emission; emission.enabled = emitted; emission.rateOverTime = 0;
            if (emitted) emission.SetBursts(new [] { new ParticleSystem.Burst(0, 1) });
            var c = ps.customData; c.enabled = true;
            c.SetMode(ParticleSystemCustomData.Custom1, ParticleSystemCustomDataMode.Vector);
            c.SetVectorComponentCount(ParticleSystemCustomData.Custom1, components);
            c.SetVector(ParticleSystemCustomData.Custom1, 0, new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0,0,1,1)));
            for (int i = 1; i < components; i++) c.SetVector(ParticleSystemCustomData.Custom1, i, i + 1);
            c.SetMode(ParticleSystemCustomData.Custom2, ParticleSystemCustomDataMode.Color);
            if (gradient) {
                var g = new Gradient();
                g.SetKeys(new [] { new GradientColorKey(Color.red, 0), new GradientColorKey(Color.blue, 1) },
                    new [] { new GradientAlphaKey(0.2f,0), new GradientAlphaKey(0.8f,1) });
                c.SetColor(ParticleSystemCustomData.Custom2, new ParticleSystem.MinMaxGradient(g));
            } else c.SetColor(ParticleSystemCustomData.Custom2, new ParticleSystem.MinMaxGradient(new Color(2,-0.2f,0.4f,0.5f)));
            ps.Simulate(0, false, true, false);
            if (emitted) ps.Play(false);
            else ps.SetParticles(new [] { new ParticleSystem.Particle {
                position = Vector3.zero, startSize = 1, startLifetime = lifetime, remainingLifetime = lifetime,
                startColor = Color.white, randomSeed = 1000
            } }, 1);
            var steps = gradient ? new [] { .03f, .07f, .01f, .12f, .02f } : Enumerable.Repeat(1f/60f,30).ToArray();
            var a = new List<Vector4>(); var b = new List<Vector4>(); var samples = new List<Sample>();
            for (int i = 0; i < steps.Length; i++) {
                ps.Simulate(steps[i], false, false, false);
                int frame = i + 1;
                if (!gradient && frame != 1 && frame != 15 && frame != 30) continue;
                ps.GetCustomParticleData(a, ParticleSystemCustomData.Custom1);
                ps.GetCustomParticleData(b, ParticleSystemCustomData.Custom2);
                var particles = new ParticleSystem.Particle[1]; ps.GetParticles(particles);
                samples.Add(new Sample { frame = frame, remaining = particles[0].remainingLifetime, custom1 = a[0], custom2 = b[0] });
            }
            return new Case { label = label, components = components, emitted = emitted, gradient = gradient,
                lifetime = lifetime, steps = steps, samples = samples.ToArray() };
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run() { try {
        var cases = new [] {1,2,3,4}.Select(c => Measure(c)).ToList();
        foreach (float lifetime in new [] {1f, 0.3f}) foreach (bool emitted in new [] {false,true})
            cases.Add(Measure(4, emitted, true, lifetime));
        var directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/custom-data"));
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
            unityVersion = Application.unityVersion, cases = cases.ToArray()
        }, true));
    } catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); } }
}
