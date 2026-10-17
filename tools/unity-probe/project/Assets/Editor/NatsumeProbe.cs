using System;
using System.IO;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

public static class NatsumeProbe
{
    [Serializable] public class CurveSample { public float time; public float value; }
    [Serializable] public class CurveCase
    {
        public string label;
        public int requestedPublicMode = -1;
        public int publicPre, publicPost, serializedPre, serializedPost;
        public CurveSample[] samples;
    }
    [Serializable] public class ParticleSample
    {
        public int frame;
        public uint seed;
        public float age;
        public Vector3 position, velocity, rotation, size;
    }
    [Serializable] public class NoiseCase
    {
        public string label;
        public bool enabled = true, damping = true;
        public float strength = 0.25f, frequency = 0.5f, scroll = 0f;
        public int quality = 2, octaves = 1;
        public float octaveMultiplier = 0.5f, octaveScale = 2f;
        public float positionAmount = 1, rotationAmount = 0, sizeAmount = 0;
        public ParticleSample[] samples;
    }
    [Serializable] public class Output
    {
        public string unityVersion, platform;
        public float step = 1f / 60f;
        public uint systemSeed = 12345, firstParticleSeed = 1000;
        public Vector3[] origins = Origins;
        public CurveCase[] curves;
        public NoiseCase[] noise;
    }

    static string OutputDirectory { get { return Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines")); } }
    static readonly float[] Times = { -2f, -1f, -0.25f, 0f, 0.125f, 0.25f, 0.5f, 0.75f, 1f, 1.25f, 2f, 2.25f };
    static readonly Vector3[] Origins = { Vector3.zero, new Vector3(0.37f, -0.21f, 0.83f), new Vector3(-1.2f, 0.6f, 0.4f) };
    static AnimationCurve LinearCurve()
    {
        return new AnimationCurve(new Keyframe(0, 2, 4, 4), new Keyframe(1, 6, 4, 4));
    }
    static CurveCase ReadCurve(string label, NatsumeCurveProbe holder, string path)
    {
        var text = File.ReadAllText(path);
        var output = new CurveCase {
            label = label,
            publicPre = (int)holder.curve.preWrapMode,
            publicPost = (int)holder.curve.postWrapMode,
            serializedPre = int.Parse(Regex.Match(text, @"m_PreInfinity: ([-0-9]+)").Groups[1].Value),
            serializedPost = int.Parse(Regex.Match(text, @"m_PostInfinity: ([-0-9]+)").Groups[1].Value),
            samples = new CurveSample[Times.Length]
        };
        for (int i = 0; i < Times.Length; i++) output.samples[i] = new CurveSample { time = Times[i], value = holder.curve.Evaluate(Times[i]) };
        return output;
    }
    static NatsumeCurveProbe SaveCurve(string path, AnimationCurve curve)
    {
        var holder = AssetDatabase.LoadAssetAtPath<NatsumeCurveProbe>(path);
        if (!holder) { holder = ScriptableObject.CreateInstance<NatsumeCurveProbe>(); AssetDatabase.CreateAsset(holder, path); }
        holder.curve = curve;
        EditorUtility.SetDirty(holder);
        AssetDatabase.SaveAssets();
        return holder;
    }
    static CurveCase[] Curves()
    {
        EditorSettings.serializationMode = SerializationMode.ForceText;
        if (!AssetDatabase.IsValidFolder("Assets/Curves")) AssetDatabase.CreateFolder("Assets", "Curves");
        var result = new List<CurveCase>();
        foreach (WrapMode mode in new [] { WrapMode.Default, WrapMode.Once, WrapMode.Loop, WrapMode.PingPong, WrapMode.ClampForever })
        {
            string path = "Assets/Curves/public-" + (int)mode + ".asset";
            var curve = LinearCurve(); curve.preWrapMode = mode; curve.postWrapMode = mode;
            var sample = ReadCurve("public-" + (int)mode, SaveCurve(path, curve), path);
            sample.requestedPublicMode = (int)mode;
            result.Add(sample);
        }
        foreach (int code in new [] { 0, 1, 2, 3, 4, 5 })
        {
            string path = "Assets/Curves/raw-" + code + ".asset";
            SaveCurve(path, LinearCurve());
            var text = File.ReadAllText(path);
            text = Regex.Replace(text, @"m_PreInfinity: [-0-9]+", "m_PreInfinity: " + code);
            text = Regex.Replace(text, @"m_PostInfinity: [-0-9]+", "m_PostInfinity: " + code);
            File.WriteAllText(path, text);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            result.Add(ReadCurve("raw-" + code, AssetDatabase.LoadAssetAtPath<NatsumeCurveProbe>(path), path));
        }
        return result.ToArray();
    }

    static ParticleSample[] RunNoise(NoiseCase settings)
    {
        var go = new GameObject("Natsume isolated noise probe");
        try
        {
            var system = go.AddComponent<ParticleSystem>();
            system.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            system.useAutoRandomSeed = false; system.randomSeed = 12345;
            var main = system.main;
            main.duration = 10; main.loop = false; main.playOnAwake = false;
            main.prewarm = false; main.startLifetime = 10; main.startSpeed = 0;
            main.startSize = 1; main.startRotation3D = true;
            main.startRotationX = 0; main.startRotationY = 0; main.startRotationZ = 0;
            main.gravityModifier = 0; main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.simulationSpeed = 1; main.maxParticles = 16;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var emission = system.emission; emission.enabled = false;
            var shape = system.shape; shape.enabled = false;
            go.GetComponent<ParticleSystemRenderer>().enabled = false;
            var noise = system.noise;
            noise.enabled = settings.enabled; noise.separateAxes = false;
            noise.strength = settings.strength; noise.frequency = settings.frequency;
            noise.damping = settings.damping; noise.quality = (ParticleSystemNoiseQuality)settings.quality;
            noise.octaveCount = settings.octaves; noise.octaveMultiplier = settings.octaveMultiplier; noise.octaveScale = settings.octaveScale;
            noise.scrollSpeed = settings.scroll; noise.remapEnabled = false;
            noise.positionAmount = settings.positionAmount; noise.rotationAmount = settings.rotationAmount; noise.sizeAmount = settings.sizeAmount;
            system.Simulate(0, false, true, false);
            for (int i = 0; i < Origins.Length; i++)
            {
                var parameters = new ParticleSystem.EmitParams {
                    position = Origins[i], velocity = Vector3.zero, startLifetime = 10, startSize = 1,
                    randomSeed = (uint)(1000 + i), applyShapeToPosition = false
                };
                system.Emit(parameters, 1);
            }
            var particles = new ParticleSystem.Particle[16];
            var result = new List<ParticleSample>();
            for (int frame = 0; frame <= 120; frame++)
            {
                if (frame != 0) system.Simulate(1f / 60f, false, false, false);
                if (frame > 4 && frame % 15 != 0) continue;
                int count = system.GetParticles(particles);
                if (count != 3) throw new Exception("Unexpected particle count: " + count);
                Array.Sort(particles, 0, count, Comparer<ParticleSystem.Particle>.Create((a,b) => a.randomSeed.CompareTo(b.randomSeed)));
                for (int i = 0; i < count; i++)
                {
                    var particle = particles[i];
                    result.Add(new ParticleSample { frame = frame, seed = particle.randomSeed,
                        age = particle.startLifetime - particle.remainingLifetime,
                        position = particle.position, velocity = particle.velocity,
                        rotation = particle.rotation3D, size = particle.GetCurrentSize3D(system) });
                }
            }
            return result.ToArray();
        }
        finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    static NoiseCase[] Noise()
    {
        var cases = new [] {
            new NoiseCase { label = "disabled", enabled = false },
            new NoiseCase { label = "base" }, new NoiseCase { label = "base-repeat" },
            new NoiseCase { label = "kirakira", strength = 0.03f, frequency = 0.28f },
            new NoiseCase { label = "kirakira-repeat", strength = 0.03f, frequency = 0.28f },
            new NoiseCase { label = "strength-zero", strength = 0 },
            new NoiseCase { label = "strength-double", strength = 0.5f },
            new NoiseCase { label = "frequency-half", frequency = 0.25f },
            new NoiseCase { label = "frequency-double", frequency = 1 },
            new NoiseCase { label = "damping-off", damping = false },
            new NoiseCase { label = "low", quality = 0 },
            new NoiseCase { label = "medium", quality = 1 },
            new NoiseCase { label = "scroll", scroll = 0.5f },
            new NoiseCase { label = "two-octaves", octaves = 2 },
            new NoiseCase { label = "rotation-only", positionAmount = 0, rotationAmount = 1 },
            new NoiseCase { label = "size-only", positionAmount = 0, sizeAmount = 1 },
            new NoiseCase { label = "position-half", positionAmount = 0.5f },
        };
        foreach (var settings in cases) settings.samples = RunNoise(settings);
        return cases;
    }
    public static void Run()
    {
        try
        {
            Directory.CreateDirectory(OutputDirectory);
            var output = new Output { unityVersion = Application.unityVersion, platform = SystemInfo.operatingSystem, curves = Curves(), noise = Noise() };
            File.WriteAllText(Path.Combine(OutputDirectory, "unity-2022.3.21f1.json"), JsonUtility.ToJson(output, true));
            Debug.Log("NATSUME_PROBE_COMPLETE " + OutputDirectory);
        }
        catch (Exception exception) { Debug.LogException(exception); EditorApplication.Exit(1); }
    }
}
