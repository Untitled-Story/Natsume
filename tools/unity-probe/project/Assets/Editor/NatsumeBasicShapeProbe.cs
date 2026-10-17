using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeBasicShapeProbe
{
    [Serializable] public class Stats { public Vector3 mean, second, min, max; public float radiusMean, radiusSecond; }
    [Serializable] public class Result { public string label; public int type, count; public float thickness, angle, length, arc, randomDirection, sphericalDirection; public Vector3 boxThickness, scale; public bool align; public Stats position, velocity; public Vector3[] firstPositions, firstVelocities, firstRotations; }
    [Serializable] public class Output { public string unityVersion; public Result[] cases; }
    static Stats Summarize(Vector3[] points)
    {
        var s = new Stats { min = Vector3.one * float.PositiveInfinity, max = Vector3.one * float.NegativeInfinity };
        foreach(var p in points) { s.mean += p / points.Length; s.second += Vector3.Scale(p,p) / points.Length; s.min = Vector3.Min(s.min,p); s.max = Vector3.Max(s.max,p); s.radiusMean += p.magnitude / points.Length; s.radiusSecond += p.sqrMagnitude / points.Length; }
        return s;
    }
    static Result Measure(string label, ParticleSystemShapeType type, float thickness = 1, float angle = 25, float length = 2, float arc = 360, float random = 0, float spherical = 0, bool align = false)
    {
        var go = new GameObject(label);
        try {
            var ps = go.AddComponent<ParticleSystem>(); ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear); ps.useAutoRandomSeed = false; ps.randomSeed = 12345;
            var main = ps.main; main.duration = 1; main.loop = false; main.playOnAwake = false; main.maxParticles = 16384; main.startLifetime = 2; main.startSpeed = 1; main.startRotation3D = true; main.startRotationX = 0; main.startRotationY = 0; main.startRotationZ = 0; main.gravityModifier = 0; main.simulationSpace = ParticleSystemSimulationSpace.Local; main.scalingMode = ParticleSystemScalingMode.Local;
            var shape = ps.shape; shape.enabled = true; shape.shapeType = type; shape.radius = 1; shape.radiusThickness = thickness; shape.angle = angle; shape.length = length; shape.arc = arc; shape.boxThickness = Vector3.one * thickness; shape.randomDirectionAmount = random; shape.sphericalDirectionAmount = spherical; shape.alignToDirection = align;
            var emission = ps.emission; emission.enabled = false; ps.GetComponent<ParticleSystemRenderer>().enabled = false;
            ps.Simulate(0, false, true, false); ps.Emit(16384);
            var particles = new ParticleSystem.Particle[16384]; int count = ps.GetParticles(particles);
            var positions = particles.Take(count).Select(p=>p.position).ToArray(); var velocities = particles.Take(count).Select(p=>p.velocity).ToArray();
            return new Result { label = label, type = (int)type, count = count, thickness = thickness, angle = angle, length = length, arc = arc, randomDirection=random, sphericalDirection=spherical, align=align, boxThickness=shape.boxThickness, scale=shape.scale, position=Summarize(positions), velocity=Summarize(velocities), firstPositions=positions.Take(8).ToArray(), firstVelocities=velocities.Take(8).ToArray(), firstRotations=particles.Take(8).Select(p=>p.rotation3D).ToArray() };
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        try {
            var cases = new List<Result>();
            foreach(var type in new [] { ParticleSystemShapeType.Sphere, ParticleSystemShapeType.Hemisphere, ParticleSystemShapeType.Box, ParticleSystemShapeType.BoxShell, ParticleSystemShapeType.BoxEdge, ParticleSystemShapeType.Cone, ParticleSystemShapeType.ConeVolume, ParticleSystemShapeType.SingleSidedEdge })
                foreach(float t in new [] { 0f, 0.25f, 1f }) cases.Add(Measure(type+"-"+t, type, t));
            cases.Add(Measure("cone-zero-angle", ParticleSystemShapeType.Cone, 1, 0));
            cases.Add(Measure("cone-volume-zero-angle", ParticleSystemShapeType.ConeVolume, 1, 0));
            cases.Add(Measure("cone-zero-length", ParticleSystemShapeType.ConeVolume, 1, 25, 0));
            cases.Add(Measure("cone-quarter", ParticleSystemShapeType.Cone, 1, 25, 2, 90));
            cases.Add(Measure("box-random", ParticleSystemShapeType.Box, 1, 25, 2, 360, 1));
            cases.Add(Measure("box-spherical", ParticleSystemShapeType.Box, 1, 25, 2, 360, 0, 1));
            cases.Add(Measure("sphere-align", ParticleSystemShapeType.Sphere, 0, 25, 2, 360, 0, 0, true));
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/basic-shapes")); Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output { unityVersion=Application.unityVersion, cases=cases.ToArray() }, true));
        } catch(Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }
}
