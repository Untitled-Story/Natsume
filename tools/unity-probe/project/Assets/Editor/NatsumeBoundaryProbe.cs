using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

// Small deterministic fixtures. Noise and the native random sequence are excluded.
public static class NatsumeBoundaryProbe
{
    [Serializable] public class Sample
    {
        public int frame, count;
        public float time, systemTime;
        public Vector3[] positions, velocities, sizes, rotations;
        public float[] remaining;
        public Color[] colors;
        public Vector3[] vertices;
        public Vector2[] uv;
    }
    [Serializable] public class Result { public string label; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion, graphicsDevice; public Result[] cases; }
    static ParticleSystem Create()
    {
        var ps = new GameObject("Natsume boundary fixture").AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        ps.useAutoRandomSeed = false; ps.randomSeed = 12345;
        var main = ps.main;
        main.duration = 1; main.loop = false; main.playOnAwake = false;
        main.startLifetime = 2; main.startSpeed = 0; main.startSize = 1;
        main.startColor = Color.white; main.gravityModifier = 0;
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.scalingMode = ParticleSystemScalingMode.Local;
        main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
        main.maxParticles = 1024;
        var emission = ps.emission; emission.enabled = false;
        var shape = ps.shape; shape.enabled = false;
        var renderer = ps.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        renderer.alignment = ParticleSystemRenderSpace.World;
        renderer.maxParticleSize = 100;
        return ps;
    }
    static Sample Read(ParticleSystem ps, int frame, float dt, Camera camera, bool bake)
    {
        var particles = new ParticleSystem.Particle[ps.particleCount];
        ps.GetParticles(particles);
        var sample = new Sample {
            frame = frame, time = frame * dt, systemTime = ps.time, count = particles.Length,
            positions = particles.Select(p => p.position).ToArray(),
            velocities = particles.Select(p => p.velocity).ToArray(),
            remaining = particles.Select(p => p.remainingLifetime).ToArray(),
            sizes = particles.Select(p => p.GetCurrentSize3D(ps)).ToArray(),
            colors = particles.Select(p => (Color)p.GetCurrentColor(ps)).ToArray(),
            rotations = particles.Select(p => p.rotation3D).ToArray()
        };
        if (bake && particles.Length > 0)
        {
            var mesh = new Mesh();
            ps.GetComponent<ParticleSystemRenderer>().BakeMesh(mesh, camera, false);
            sample.vertices = mesh.vertices; sample.uv = mesh.uv;
            UnityEngine.Object.DestroyImmediate(mesh);
        }
        return sample;
    }
    static Result Emission(string label, Action<ParticleSystem> configure, Camera camera)
    {
        var ps = Create();
        try
        {
            configure(ps);
            ps.Simulate(0, false, true, false);
            ps.Play(false);
            const float dt = 1f / 60f;
            var samples = new List<Sample> { Read(ps, 0, dt, camera, false) };
            for (int frame = 1; frame <= 18; frame++)
            {
                ps.Simulate(dt, false, false, false);
                samples.Add(Read(ps, frame, dt, camera, false));
            }
            return new Result { label = label, samples = samples.ToArray() };
        }
        finally { UnityEngine.Object.DestroyImmediate(ps.gameObject); }
    }
    static Result Manual(string label, Action<ParticleSystem> configure, Camera camera, bool bake = false, float dt = 1f/60f)
    {
        var ps = Create();
        try
        {
            configure(ps);
            ps.Simulate(0, false, true, false);
            ps.SetParticles(new [] { new ParticleSystem.Particle {
                position = new Vector3(1, 0.5f, 0.2f), velocity = new Vector3(2, 0, 0),
                startLifetime = 1, remainingLifetime = 1, startSize3D = new Vector3(2, 3, 4),
                rotation3D = new Vector3(20, 35, 55), startColor = new Color(0.8f, 0.6f, 0.4f, 0.5f), randomSeed = 1000
            } }, 1);
            var samples = new List<Sample> { Read(ps, 0, dt, camera, bake) };
            for (int frame = 1; frame <= 61; frame++)
            {
                ps.Simulate(dt, false, false, false);
                if (frame <= 4 || frame == 15 || frame == 30 || frame == 45 || frame >= 59)
                    samples.Add(Read(ps, frame, dt, camera, bake));
            }
            if (label.EndsWith("-node-rotated"))
                foreach (var sample in samples.Where(s => s.vertices != null)) sample.vertices = sample.vertices.Select(p => ps.transform.TransformPoint(p)).ToArray();
            return new Result { label = label, samples = samples.ToArray() };
        }
        finally { UnityEngine.Object.DestroyImmediate(ps.gameObject); }
    }
    static void Rate(ParticleSystem ps, float rate, bool loop = false)
    {
        var main = ps.main; main.duration = 0.1f; main.loop = loop;
        var e = ps.emission; e.enabled = true; e.rateOverTime = rate;
    }
    static void Velocity(ParticleSystem ps, Vector3 linear, Vector3 orbital, float radial, float multiplier, bool limit)
    {
        var v = ps.velocityOverLifetime; v.enabled = true; v.space = ParticleSystemSimulationSpace.Local;
        v.x = linear.x; v.y = linear.y; v.z = linear.z;
        v.orbitalX = orbital.x; v.orbitalY = orbital.y; v.orbitalZ = orbital.z;
        v.radial = radial; v.speedModifier = multiplier;
        if (limit) { var l = ps.limitVelocityOverLifetime; l.enabled = true; l.limit = 0.12f; l.dampen = 0.26f; }
    }
    static void Appearance(ParticleSystem ps, bool fixedGradient)
    {
        var s = ps.sizeOverLifetime; s.enabled = true; s.separateAxes = true;
        s.x = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 0.5f, 1, 2));
        s.y = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 2, 1, 0.5f)); s.z = 1;
        var gradient = new Gradient();
        gradient.SetKeys(new [] { new GradientColorKey(Color.red, 0), new GradientColorKey(Color.green, 0.5f), new GradientColorKey(Color.blue, 1) },
            new [] { new GradientAlphaKey(0, 0), new GradientAlphaKey(1, 0.5f), new GradientAlphaKey(0, 1) });
        gradient.mode = fixedGradient ? GradientMode.Fixed : GradientMode.Blend;
        var c = ps.colorOverLifetime; c.enabled = true; c.color = gradient;
    }
    static void Sheet(ParticleSystem ps, float start, float cycles)
    {
        var s = ps.textureSheetAnimation; s.enabled = true; s.numTilesX = 4; s.numTilesY = 2;
        s.animation = ParticleSystemAnimationType.WholeSheet; s.timeMode = ParticleSystemAnimationTimeMode.Lifetime;
        s.frameOverTime = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 0, 1, 1));
        s.startFrame = start; s.cycleCount = (int)cycles;
    }
    static void MeshRenderer(ParticleSystem ps)
    {
        var mesh = new Mesh();
        mesh.vertices = new [] { new Vector3(-0.5f,-0.5f,0), new Vector3(0.5f,-0.5f,0), new Vector3(0.5f,0.5f,0), new Vector3(-0.5f,0.5f,0) };
        mesh.uv = new [] { Vector2.zero, Vector2.right, Vector2.one, Vector2.up };
        mesh.triangles = new [] { 0, 1, 2, 0, 2, 3 }; mesh.RecalculateBounds();
        var r = ps.GetComponent<ParticleSystemRenderer>(); r.renderMode = ParticleSystemRenderMode.Mesh; r.mesh = mesh;
    }
    static void Stretch(ParticleSystem ps, float length, bool zeroSpeed = false)
    {
        var r = ps.GetComponent<ParticleSystemRenderer>(); r.renderMode = ParticleSystemRenderMode.Stretch;
        r.lengthScale = length; r.velocityScale = 0; r.cameraVelocityScale = 0;
        r.freeformStretching = false; r.rotateWithStretchDirection = true;
        if (zeroSpeed) { var v = ps.velocityOverLifetime; v.enabled = true; v.x = -2; }
    }
    public static void Run()
    {
        try
        {
            if (Application.unityVersion != "2022.3.21f1" || SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
                throw new Exception("Unity 2022.3.21f1 with a graphics device required");
            var cameraObject = new GameObject("Boundary reference camera");
            var camera = cameraObject.AddComponent<Camera>(); camera.orthographic = true;
            camera.transform.position = new Vector3(0, 0, -10); camera.orthographicSize = 5;
            var cases = new List<Result> {
                Emission("rate-delayed", ps => { Rate(ps,60); var m=ps.main;m.duration=1;m.startDelay=0.2f; }, camera),
                Emission("rate-60-once", ps => Rate(ps, 60), camera),
                Emission("rate-60-loop", ps => Rate(ps, 60, true), camera),
                Emission("rate-curve", ps => { Rate(ps, 0); var e = ps.emission; e.rateOverTime = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 0, 1, 120)); }, camera),
                Emission("burst-zero", ps => { Rate(ps, 0); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, 3) }); }, camera),
                Emission("burst-loop", ps => { Rate(ps, 0, true); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, 3) }); }, camera),
                Emission("burst-end", ps => { Rate(ps, 0, true); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0.1f, 3) }); }, camera),
                Emission("burst-repeat", ps => { Rate(ps, 0); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0.025f, (short)2, (short)2, 4, 0.02f) }); }, camera),
                Emission("burst-infinite", ps => { Rate(ps, 0); var main = ps.main; main.duration = 0.2f; var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, (short)2, (short)2, 0, 0.05f) }); }, camera),
                Emission("burst-infinite-loop", ps => { Rate(ps, 0, true); var main = ps.main; main.duration = 0.2f; var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, (short)2, (short)2, 0, 0.05f) }); }, camera),
                Emission("burst-infinite-delayed", ps => { Rate(ps, 0); var main = ps.main; main.duration = 0.2f; var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0.025f, (short)2, (short)2, 0, 0.05f) }); }, camera),
                Emission("burst-infinite-zero-interval", ps => { Rate(ps, 0); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, (short)2, (short)2, 0, 0) }); }, camera),
                Emission("burst-finite-zero-interval", ps => { Rate(ps, 0); var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, (short)2, (short)2, 3, 0) }); }, camera),
                Emission("death-boundary", ps => { Rate(ps, 0); var main = ps.main; main.startLifetime = 0.05f; var e = ps.emission; e.SetBursts(new [] { new ParticleSystem.Burst(0, 1) }); }, camera),
                Manual("motion-linear", ps => Velocity(ps, new Vector3(1,2,3), Vector3.zero, 0, 1, false), camera),
                Manual("motion-linear-limit", ps => Velocity(ps, new Vector3(1,2,3), Vector3.zero, 0, 1, true), camera),
                Manual("motion-orbital-limit", ps => Velocity(ps, Vector3.zero, new Vector3(1,0.5f,0), 0, 1, true), camera),
                Manual("motion-multiplier-only", ps => Velocity(ps, Vector3.zero, new Vector3(1,0.5f,0), 0, 2, false), camera),
                Manual("motion-radial", ps => Velocity(ps, Vector3.zero, Vector3.zero, 1, 1, false), camera),
                Manual("motion-multiplier", ps => Velocity(ps, new Vector3(1,2,3), new Vector3(1,0.5f,0), 0.4f, 2, false), camera),
                Manual("motion-limit-combined", ps => Velocity(ps, new Vector3(1,2,3), new Vector3(1,0.5f,0), 0.4f, 2, true), camera),
                Manual("appearance-blend", ps => Appearance(ps, false), camera, true),
                Manual("appearance-mesh", ps => { Appearance(ps, false); MeshRenderer(ps); }, camera, true),
                Manual("mesh-view", ps => { MeshRenderer(ps); ps.GetComponent<ParticleSystemRenderer>().alignment = ParticleSystemRenderSpace.View; }, camera, true),
                Manual("mesh-view-node-rotated", ps => { MeshRenderer(ps); ps.GetComponent<ParticleSystemRenderer>().alignment = ParticleSystemRenderSpace.View; ps.transform.rotation = Quaternion.Euler(0,0,90); }, camera, true),
                Manual("mesh-world-node-rotated", ps => { MeshRenderer(ps); ps.transform.rotation = Quaternion.Euler(0,0,90); }, camera, true),
                Manual("mesh-local-node-rotated", ps => { MeshRenderer(ps); ps.GetComponent<ParticleSystemRenderer>().alignment = ParticleSystemRenderSpace.Local; ps.transform.rotation = Quaternion.Euler(0,0,90); }, camera, true),
                Manual("billboard-pivot", ps => { ps.GetComponent<ParticleSystemRenderer>().pivot = new Vector3(0.25f,-0.5f,0.1f); }, camera, true),
                Manual("billboard-flip", ps => { ps.GetComponent<ParticleSystemRenderer>().flip = new Vector3(1,1,0); }, camera, true),
                Manual("billboard-local-node-rotated", ps => { ps.GetComponent<ParticleSystemRenderer>().alignment = ParticleSystemRenderSpace.Local; ps.transform.rotation = Quaternion.Euler(0,0,90); }, camera, true),
                Manual("billboard-world-node-rotated", ps => { ps.transform.rotation = Quaternion.Euler(0,0,90); }, camera, true),
                Manual("stretch-view", ps => { Stretch(ps, -4); ps.GetComponent<ParticleSystemRenderer>().alignment = ParticleSystemRenderSpace.View; }, camera, true),
                Manual("stretch-negative-four", ps => Stretch(ps, -4), camera, true),
                Manual("stretch-negative-one", ps => Stretch(ps, -1), camera, true),
                Manual("stretch-positive", ps => Stretch(ps, 2), camera, true),
                Manual("stretch-zero-speed", ps => Stretch(ps, -4, true), camera, true),
                Manual("stretch-linear-velocity", ps => { Stretch(ps, -4); var v = ps.velocityOverLifetime; v.enabled = true; v.x = 0; v.y = 2; }, camera, true),
                Manual("appearance-fixed", ps => Appearance(ps, true), camera, true),
                Manual("sheet-zero", ps => Sheet(ps, 0, 1), camera, true),
                Manual("sheet-start-two", ps => Sheet(ps, 2, 1), camera, true),
                Manual("sheet-start-quarter", ps => Sheet(ps, 0.25f, 2), camera, true),
                Manual("sheet-constant-one", ps => { Sheet(ps, 0, 1); var s = ps.textureSheetAnimation; s.frameOverTime = 1; }, camera, true),
                Manual("sheet-constant-quarter-twice", ps => { Sheet(ps, 0, 2); var s = ps.textureSheetAnimation; s.frameOverTime = 0.25f; }, camera, true),
                Manual("sheet-nonlinear-twice", ps => { Sheet(ps, 0, 2); var s = ps.textureSheetAnimation; s.frameOverTime = new ParticleSystem.MinMaxCurve(1, new AnimationCurve(new Keyframe(0,0,0,0), new Keyframe(1,1,2,2))); }, camera, true)
            };
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/boundaries"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
                unityVersion = Application.unityVersion, graphicsDevice = SystemInfo.graphicsDeviceType.ToString(), cases = cases.ToArray()
            }, true));
            UnityEngine.Object.DestroyImmediate(cameraObject);
            Debug.Log("NATSUME_BOUNDARY_COMPLETE " + output);
        }
        catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }
}
