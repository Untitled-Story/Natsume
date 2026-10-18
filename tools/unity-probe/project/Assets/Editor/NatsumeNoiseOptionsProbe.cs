using System;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEditor;

public static class NatsumeNoiseOptionsProbe
{
    [Serializable] public class Sample { public int frame; public Vector3 position, rotation, size, bakedSize; }
    [Serializable] public class Case { public string label; public Sample[] samples; }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    static Case Measure(string label)
    {
        var go = new GameObject(label); var cameraObject = new GameObject("Noise camera"); var camera=cameraObject.AddComponent<Camera>(); camera.orthographic=true;camera.transform.position=new Vector3(0,0,-10);
        try {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed = false; ps.randomSeed = 12345;
            var main = ps.main; main.playOnAwake = false; main.startSpeed = 0; main.gravityModifier = 0;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            var emission = ps.emission; emission.enabled = false;
            var shape = ps.shape; shape.enabled = false;
            var n = ps.noise; n.enabled = true; n.quality = ParticleSystemNoiseQuality.High;
            n.frequency = label == "frequency-zero" ? 0 : 0.28f; n.strength = label == "strength-zero" ? 0 : 1;
            n.damping = true; n.positionAmount = label == "rotation" || label == "size" ? 0 : 1;
            n.rotationAmount = label == "rotation" ? 1 : 0;
            n.sizeAmount = label == "size" ? 1 : 0;
            n.scrollSpeed = label == "scroll" ? 1 : 0;
            if (label.StartsWith("remap")) { n.remapEnabled = true; n.remap = label == "remap-negative" ? -0.25f : 0.25f; }
            if (label == "octaves") { n.octaveCount = 3; n.octaveMultiplier = 0.5f; n.octaveScale = 2; }
            if (label == "low") n.quality = ParticleSystemNoiseQuality.Low;
            if (label == "medium") n.quality = ParticleSystemNoiseQuality.Medium;
            ps.Simulate(0, false, true, false);
            ps.SetParticles(new [] {new ParticleSystem.Particle {
                position = new Vector3(1,2,3), startLifetime = 2, remainingLifetime = 2,
                startSize3D = new Vector3(2,3,4), startColor = Color.white, randomSeed = 1000
            }}, 1);
            var samples = new Sample[3];
            var particles = new ParticleSystem.Particle[1];
            for(int frame=0;frame<3;frame++) {
                if(frame>0) ps.Simulate(1f/60,false,false,false);
                ps.GetParticles(particles);
                var mesh=new Mesh();ps.GetComponent<ParticleSystemRenderer>().maxParticleSize=100;ps.GetComponent<ParticleSystemRenderer>().BakeMesh(mesh,camera,false);
                mesh.RecalculateBounds();
                samples[frame] = new Sample {frame=frame, position=particles[0].position, rotation=particles[0].rotation3D, size=particles[0].GetCurrentSize3D(ps),bakedSize=mesh.bounds.size};
                UnityEngine.Object.DestroyImmediate(mesh);
            }
            return new Case {label=label,samples=samples};
        } finally {UnityEngine.Object.DestroyImmediate(go);UnityEngine.Object.DestroyImmediate(cameraObject);}
    }
    public static void Run() {
        try {
            var output = new Output { unityVersion=Application.unityVersion, cases=new [] {"position","rotation","size","scroll","remap-positive","remap-negative","octaves","low","medium","frequency-zero","strength-zero"}.Select(Measure).ToArray() };
            var directory=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/noise-options"));
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));
        } catch(Exception e) { Debug.LogException(e); EditorApplication.Exit(1); }
    }
}
