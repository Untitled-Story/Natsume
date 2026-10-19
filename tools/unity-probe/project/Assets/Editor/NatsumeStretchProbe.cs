using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeStretchProbe
{
    [Serializable] public class Case {
        public string label;
        public Vector3 velocity, viewVelocity, position, viewPosition, size;
        public float[] viewMatrix;
        public float lengthScale, velocityScale, cameraVelocityScale;
        public bool freeform, rotate;
        public Vector3[] vertices;
        public Vector2[] uv;
    }
    [Serializable] public class Output { public string unityVersion; public Case[] cases; }
    [InitializeOnLoadMethod]
    static void Resume()
    {
        if (!SessionState.GetBool("NatsumeStretchMotion", false)) return;
        SessionState.SetBool("NatsumeStretchMotion", false);
        EditorApplication.delayCall += () => new GameObject("Camera motion probe").AddComponent<NatsumeCameraMotionProbe>();
    }
    public static void Run()
    {
        var cameraObject = new GameObject("Stretch camera");
        var camera = cameraObject.AddComponent<Camera>();
        camera.orthographic = true; camera.orthographicSize = 5;
        camera.transform.position = new Vector3(0, 0, -10);
        camera.targetTexture = new RenderTexture(64, 64, 24);
        var go = new GameObject("Stretch particle");
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.scalingMode = ParticleSystemScalingMode.Local;
        var emission = ps.emission; emission.enabled = false;
        var shape = ps.shape; shape.enabled = false;
        var r = ps.GetComponent<ParticleSystemRenderer>();
        r.renderMode = ParticleSystemRenderMode.Stretch; r.alignment = ParticleSystemRenderSpace.View;
        r.maxParticleSize = 100;
        var results = new List<Case>();
        var particlePosition = new Vector3(1, 0.5f, 0.2f);
        var particleSize = new Vector3(2,3,4);
        Action<string, Vector3, float, float, bool, bool, float> measure = (label, velocity, length, speed, freeform, rotate, cameraScale) => {
            r.lengthScale = length; r.velocityScale = speed; r.cameraVelocityScale = cameraScale;
            r.freeformStretching = freeform; r.rotateWithStretchDirection = rotate;
            ps.Simulate(0, false, true, false);
            ps.SetParticles(new [] { new ParticleSystem.Particle {
                position = particlePosition, velocity = velocity,
                startLifetime = 1, remainingLifetime = 1, startSize3D = particleSize,
                rotation3D = new Vector3(20,35,55), startColor = Color.white, randomSeed = 1000
            } }, 1);
            var mesh = new Mesh(); r.BakeMesh(mesh, camera, false);
            var view = Matrix4x4.Rotate(Quaternion.Inverse(camera.transform.rotation));
            results.Add(new Case { label = label, velocity = velocity, viewVelocity = camera.velocity,
                position = particlePosition, viewPosition = camera.transform.position, size = particleSize,
                viewMatrix = Enumerable.Range(0,16).Select(i => view[i]).ToArray(),
                lengthScale = length, velocityScale = speed, cameraVelocityScale = cameraScale,
                freeform = freeform, rotate = rotate, vertices = mesh.vertices, uv = mesh.uv });
            UnityEngine.Object.DestroyImmediate(mesh);
        };
        try {
            const bool freeform = false;
            foreach (bool rotate in new [] { false, true }) {
                    string prefix = rotate ? "ordinary-rotate" : "ordinary-fixed";
                    measure(prefix+"-xy", new Vector3(2,3,0), 2, 1, freeform, rotate, 0);
                    measure(prefix+"-xyz", new Vector3(2,3,4), 2, 1, freeform, rotate, 0);
                    measure(prefix+"-z", new Vector3(0,0,4), 2, 1, freeform, rotate, 0);
                    measure(prefix+"-zero", Vector3.zero, 2, 1, freeform, rotate, 0);
                }
            measure("speed-positive", new Vector3(2,0,0), 2, 1, false, true, 0);
            measure("speed-negative-length", new Vector3(2,0,0), -4, 1, false, true, 0);
            measure("speed-zero-length", new Vector3(2,0,0), 0, 1, false, true, 0);
            measure("speed-negative-scale", new Vector3(2,0,0), 2, -1, false, true, 0);
            particlePosition = new Vector3(-3,2,1);
            camera.transform.position = new Vector3(2,-1,-7);
            measure("offset-xyz", new Vector3(-2,1,3), 1.5f, 0.7f, false, true, 0);
            measure("offset-negative", new Vector3(1,-3,2), -2, -0.5f, false, false, 0);
            camera.transform.rotation = Quaternion.Euler(20,35,10);
            measure("tilted-xyz", new Vector3(2,3,4), 2, 1, false, true, 0);
            measure("tilted-negative", new Vector3(-2,1,3), -2, 0.5f, false, false, 0);
            camera.transform.rotation = Quaternion.identity;
            camera.transform.position = new Vector3(0,0,-10);
            particlePosition = new Vector3(1,0.5f,0.2f);
            var directions = new [] {
                new Vector3(2,3,0), new Vector3(2,3,4), new Vector3(-2,1,3),
                new Vector3(1,1,0), new Vector3(1,2,0), new Vector3(1,3,0),
                new Vector3(1,4,0), new Vector3(1,5,0), new Vector3(1,7,0),
                new Vector3(0.1f,0.2f,0.3f), new Vector3(7,11,13)
            };
            for(int i=0;i<directions.Length;i++) {
                measure("isolated-length-"+i, directions[i], 2, 0, false, true, 0);
                measure("isolated-speed-"+i, directions[i], 0, 1, false, true, 0);
            }
            for(int i=0;i<=128;i++) {
                float speed = 0.5f+i/32f;
                measure("length-scan-"+i, new Vector3(speed,0,0), 2, 0, false, true, 0);
            }
            uint seed = 72931;
            Func<float> next = () => { seed = unchecked(seed*1664525u+1013904223u); return (seed>>8)/16777216f; };
            for(int i=0;i<72;i++) {
                particlePosition = new Vector3(next()*4-2,next()*4-2,next()*4-2);
                particleSize = new Vector3(0.2f+next()*4,0.2f+next()*4,0.2f+next()*4);
                camera.transform.position = new Vector3(next()*8-4,next()*8-4,-3-next()*10);
                camera.transform.rotation = Quaternion.Euler(next()*80-40,next()*80-40,next()*120-60);
                var velocity = new Vector3(next()*8-4,next()*8-4,next()*8-4)*Mathf.Pow(2,i%5-2);
                measure("holdout-"+i, velocity, next()*8-4, next()*4-2, false, i%2==0, 0);
            }
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/stretch"));
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "unity-2022.3.21f1.json"), JsonUtility.ToJson(new Output {
                unityVersion = Application.unityVersion, cases = results.ToArray()
            }, true));
        } finally {
            UnityEngine.Object.DestroyImmediate(camera.targetTexture);
            UnityEngine.Object.DestroyImmediate(go); UnityEngine.Object.DestroyImmediate(cameraObject);
        }
        SessionState.SetBool("NatsumeStretchMotion", true);
        EditorApplication.EnterPlaymode();
    }
}
