#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/** Samples actual player-loop startup, independently of ParticleSystem.Simulate. */
public sealed class NatsumeSubEmitterPlaybackProbe : MonoBehaviour
{
    [Serializable] public sealed class Particle
    {
        public Vector3 position, velocity;
        public float age, lifetime;
        public uint seed;
    }
    [Serializable] public sealed class Sample
    {
        public int frame;
        public float delta, time;
        public bool playing, emitting;
        public Particle[] parent, child, grand;
    }
    [Serializable] public sealed class Case
    {
        public float rootLifetime, childLifetime, grandLifetime, duration, rate;
        public int topology, firstEvent, secondEvent;
        public bool warm, delay;
        public List<Sample> samples = new List<Sample>();
        [NonSerialized] public ParticleSystem parent, child, grand;
    }
    [Serializable] public sealed class Output
    {
        public string unityVersion;
        public int framesPerSecond;
        public List<Case> cases = new List<Case>();
    }
    readonly Output output = new Output();
    int startupFrames, frame;
    bool begun;

    public static void Run()
    {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled = true;
        EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload |
            EnterPlayModeOptions.DisableSceneReload;
        new GameObject("sub-emitter-playback").AddComponent<NatsumeSubEmitterPlaybackProbe>();
        EditorApplication.EnterPlaymode();
    }

    void Start()
    {
        output.unityVersion = Application.unityVersion;
        output.framesPerSecond = int.Parse(Environment.GetEnvironmentVariable("NATSUME_PLAYBACK_FPS") ?? "60");
        Time.captureFramerate = output.framesPerSecond;
    }

    ParticleSystem Make(Transform owner, float lifetime, float delay, bool root, int burst)
    {
        var go = new GameObject(root ? "parent" : "child");
        go.transform.SetParent(owner, false);
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        ps.useAutoRandomSeed = false;
        ps.randomSeed = 12345;
        var main = ps.main;
        main.duration = 1;
        main.loop = root;
        main.prewarm = root;
        main.playOnAwake = false;
        main.startLifetime = lifetime;
        main.startSpeed = root ? 0 : 1;
        main.startDelay = delay;
        main.maxParticles = 1000;
        main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
        var shape = ps.shape;
        shape.enabled = false;
        var emission = ps.emission;
        emission.enabled = root;
        emission.rateOverTime = root ? 10 : 0;
        emission.SetBursts(root ? new ParticleSystem.Burst[0] : new[] { new ParticleSystem.Burst(0, burst) });
        ps.GetComponent<ParticleSystemRenderer>().enabled = false;
        return ps;
    }

    void Add(float[] config, int first, int second, bool warm = true, bool delay = false)
    {
        var c = new Case {
            rootLifetime = config[0], childLifetime = config[1], grandLifetime = config[2],
            duration = config[3], rate = config[4], topology = (int)config[5],
            firstEvent = first, secondEvent = second, warm = warm, delay = delay
        };
        c.parent = Make(transform, c.rootLifetime, delay ? .15f : 0, true, 0);
        c.child = Make(c.parent.transform, c.childLifetime, delay ? .1f : 0, false, 2);
        c.grand = Make(c.child.transform, c.grandLifetime, delay ? .05f : 0, false, 3);
        var sub = c.parent.subEmitters;
        sub.enabled = true;
        sub.AddSubEmitter(c.child, (ParticleSystemSubEmitterType)first, ParticleSystemSubEmitterProperties.InheritNothing);
        if (c.topology == 4)
            sub.AddSubEmitter(c.grand, (ParticleSystemSubEmitterType)second, ParticleSystemSubEmitterProperties.InheritNothing);
        if (c.topology == 3)
        {
            var childSub = c.child.subEmitters;
            childSub.enabled = true;
            childSub.AddSubEmitter(c.grand, (ParticleSystemSubEmitterType)second, ParticleSystemSubEmitterProperties.InheritNothing);
        }
        var main = c.parent.main;
        main.duration = c.duration;
        main.prewarm = warm;
        var emission = c.parent.emission;
        emission.rateOverTime = c.rate;
        output.cases.Add(c);
    }

    void Begin()
    {
        var configs = new[] {
            new[] { .3f, .4f, .5f, 1f, 10f, 3f },
            new[] { .3f, 1.4f, 2.4f, 1f, 10f, 3f },
            new[] { .17f, .65f, .9f, 1f, 10f, 3f },
            new[] { .6f, .35f, 1.2f, .7f, 13f, 3f },
            new[] { .3f, 1.2f, .2f, 1f, 10f, 3f },
            new[] { .8f, .2f, .1f, 1f, 10f, 3f },
            new[] { .3f, .4f, .6f, 1f, 10f, 4f },
            new[] { .3f, .4f, .5f, 1f, 10f, 2f },
            new[] { .17f, .65f, .9f, 1f, 10f, 2f }
        };
        foreach (var config in configs)
            foreach (int first in new[] { 0, 2 })
                foreach (int second in new[] { 0, 2 }) Add(config, first, second);
        foreach (int first in new[] { 0, 2 })
            foreach (int second in new[] { 0, 2 })
            {
                Add(configs[0], first, second, true, true);
                Add(configs[0], first, second, false, true);
            }
        foreach (var c in output.cases)
        {
            c.parent.Play(false);
            Record(c, 0);
        }
    }

    static Particle[] Read(ParticleSystem ps)
    {
        var particles = new ParticleSystem.Particle[ps.particleCount];
        ps.GetParticles(particles);
        return Array.ConvertAll(particles, p => new Particle {
            position = p.position, velocity = p.totalVelocity,
            age = p.startLifetime - p.remainingLifetime, lifetime = p.startLifetime,
            seed = p.randomSeed
        });
    }

    void Record(Case c, int index)
    {
        c.samples.Add(new Sample {
            frame = index, delta = Time.deltaTime, time = c.parent.time,
            playing = c.parent.isPlaying, emitting = c.parent.isEmitting,
            parent = Read(c.parent), child = Read(c.child), grand = Read(c.grand)
        });
    }

    void LateUpdate()
    {
        try
        {
            if (!begun)
            {
                if (++startupFrames < 3) return;
                Begin();
                begun = true;
                return;
            }
            frame++;
            foreach (var c in output.cases) Record(c, frame);
            if (frame < 180) return;
            var path = Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, JsonUtility.ToJson(output, true));
            EditorApplication.Exit(0);
        }
        catch (Exception error)
        {
            Debug.LogException(error);
            EditorApplication.Exit(1);
        }
    }
}
#endif
