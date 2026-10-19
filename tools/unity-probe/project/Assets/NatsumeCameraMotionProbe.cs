#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public class NatsumeCameraMotionProbe : MonoBehaviour
{
    [Serializable] public class Sample {
        public Vector3 viewVelocity, velocity, position, viewPosition;
        public float[] viewMatrix;
        public float cameraScale, velocityScale, lengthScale;
        public Vector3[] vertices;
        public Vector2[] uv;
    }
    [Serializable] public class Output { public string unityVersion; public Sample[] cases; }
    Camera view;
    ParticleSystem ps;
    int frames;
    readonly List<Sample> cases = new List<Sample>();
    void Start()
    {
        Time.captureDeltaTime = 1f / 60f;
        view = new GameObject("Moving stretch camera").AddComponent<Camera>();
        view.orthographic = true; view.transform.position = new Vector3(0,0,-10);
        view.targetTexture = new RenderTexture(64,64,24);
        ps = new GameObject("Moving view particles").AddComponent<ParticleSystem>();
        ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main; main.playOnAwake = false; main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.scalingMode = ParticleSystemScalingMode.Local;
        var emission = ps.emission; emission.enabled = false;
        var shape = ps.shape; shape.enabled = false;
        var r = ps.GetComponent<ParticleSystemRenderer>(); r.renderMode = ParticleSystemRenderMode.Stretch;
        r.alignment = ParticleSystemRenderSpace.View; r.maxParticleSize = 100;
    }
    void Update() {
        int stage = frames / 20;
        var motion = stage == 0 ? new Vector3(0,3,0) : stage == 1 ? new Vector3(2,-1,1) : new Vector3(-1,2,-2);
        view.transform.position += motion * Time.deltaTime;
        view.transform.rotation = Quaternion.Euler(stage*15,stage*-20,stage*10);
    }
    void LateUpdate()
    {
        if (++frames % 20 != 0) return;
        try {
            view.Render();
            var r = ps.GetComponent<ParticleSystemRenderer>();
            foreach (var velocity in new [] {new Vector3(2,0,0),new Vector3(2,3,4),new Vector3(-1,0.5f,-2),Vector3.zero})
            foreach (float cameraScale in new [] {0f, 1f, 2f, -1f})
                foreach (float velocityScale in new [] {-1f, 0f, 1f})
                    foreach (float lengthScale in new [] {0f, 2f}) {
                        r.cameraVelocityScale = cameraScale; r.velocityScale = velocityScale; r.lengthScale = lengthScale;
                        r.freeformStretching = false; r.rotateWithStretchDirection = true;
                        ps.SetParticles(new [] { new ParticleSystem.Particle {
                            position = new Vector3(1,0.5f,0.2f), velocity = velocity,
                            startLifetime = 1, remainingLifetime = 1, startSize3D = new Vector3(2,3,4),
                            startColor = Color.white, randomSeed = 1000
                        } }, 1);
                        var mesh = new Mesh(); r.BakeMesh(mesh, view, false);
                        var matrix = Matrix4x4.Rotate(Quaternion.Inverse(view.transform.rotation));
                        cases.Add(new Sample { viewVelocity = view.velocity, velocity = velocity,
                            position = new Vector3(1,0.5f,0.2f), viewPosition = view.transform.position,
                            viewMatrix = Enumerable.Range(0,16).Select(i => matrix[i]).ToArray(),
                            cameraScale = cameraScale, velocityScale = velocityScale, lengthScale = lengthScale,
                            vertices = mesh.vertices, uv = mesh.uv });
                        UnityEngine.Object.Destroy(mesh);
                    }
            if(frames<60)return;
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/stretch/camera-motion.json"));
            File.WriteAllText(output, JsonUtility.ToJson(new Output { unityVersion = Application.unityVersion, cases = cases.ToArray() }, true));
            EditorApplication.Exit(0);
        } catch(Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }
}
#endif
