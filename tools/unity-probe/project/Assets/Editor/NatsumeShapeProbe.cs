using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeShapeProbe
{
    [Serializable] public class Result { public string label; public float radius, jitter; public Vector3 scale; public bool rotated; public Vector3[] positions, velocities; }
    [Serializable] public class Output { public string unityVersion; public Result[] cases; }
    static Result Measure(string label, float radius, float arc, float jitter, Vector3 scale, bool rotate, bool spread, int count, bool burst)
    {
        var go = new GameObject(label);
        try
        {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear); ps.useAutoRandomSeed = false; ps.randomSeed = 12345;
            var main = ps.main; main.duration = 1; main.loop = false; main.playOnAwake = false; main.maxParticles = count;
            main.startLifetime = 2; main.startSpeed = burst ? 0 : 1; main.gravityModifier = 0;
            main.simulationSpace = ParticleSystemSimulationSpace.Local; main.scalingMode = ParticleSystemScalingMode.Local;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var shape = ps.shape; shape.enabled = true; shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = radius; shape.radiusThickness = 0; shape.arc = arc; shape.randomPositionAmount = jitter;
            shape.scale = scale; shape.position = new Vector3(4,5,6); shape.rotation = rotate ? new Vector3(0,0,90) : Vector3.zero;
            shape.arcMode = spread ? ParticleSystemShapeMultiModeValue.BurstSpread : ParticleSystemShapeMultiModeValue.Random;
            var emission = ps.emission; emission.enabled = burst; emission.rateOverTime = 0;
            if (burst) emission.SetBursts(new [] { new ParticleSystem.Burst(0, (short)count) });
            ps.GetComponent<ParticleSystemRenderer>().enabled = false;
            ps.Simulate(0, false, true, false);
            if (burst) { ps.Play(false); ps.Simulate(1f/60, false, false, false); } else ps.Emit(count);
            var particles = new ParticleSystem.Particle[count]; int found = ps.GetParticles(particles);
            if (found != count) throw new Exception(label + ": count " + found);
            return new Result { label = label, radius = radius, jitter = jitter, scale = scale, rotated = rotate, positions = particles.Select(p => p.position).ToArray(), velocities = particles.Select(p => p.velocity).ToArray() };
        }
        finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        try
        {
            var cases = new List<Result>();
            foreach (float jitter in new [] { 0f, 0.2f, 1f })
                cases.Add(Measure("jitter-" + jitter, 0, 360, jitter, Vector3.one, false, false, 16384, false));
            cases.Add(Measure("jitter-scaled", 0, 360, 1, new Vector3(2,3,0), true, false, 16384, false));
            cases.Add(Measure("jitter-residual", 2, 360, 0.4f, Vector3.one, false, false, 16384, false));
            foreach (int count in new [] { 1, 2, 3, 8 })
                foreach (float arc in new [] { 90f, 360f })
                    cases.Add(Measure("spread-" + count + "-" + arc, 2, arc, 0, Vector3.one, false, true, count, true));
            cases.Add(Measure("spread-manual", 2, 90, 0, Vector3.one, false, true, 8, false));
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/shape"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output { unityVersion = Application.unityVersion, cases = cases.ToArray() }, true));
        }
        catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }
}
