using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEditor.SceneManagement;

// Runs the imported prefab, not a reconstruction from NOIR. Empty exported
// MonoBehaviours have no game logic. Native simulation and BakeMesh are measured.
public static class NatsumePrefabLayoutProbe
{
    const string PrefabPath = "Assets/KirakiraLayout/kirakira_01.prefab";
    [Serializable] public class SystemSample
    {
        public string path, simulationSpace, renderMode, shader;
        public Vector3 localPosition, worldPosition, localScale, worldScale;
        public bool rendererEnabled, shaderSupported;
        public int count, bakedVertexCount;
        public Vector3 particleWorldMin, particleWorldMax, particleWorldMean;
        public Bounds nativeRendererBounds, bakedLocalBounds, bakedTransformedBounds;
    }
    [Serializable] public class Case
    {
        public string name, image;
        public float seconds;
        public SystemSample[] systems;
    }
    [Serializable] public class Output
    {
        public string unityVersion, graphicsDevice, prefabSha256, caveat;
        public int gameScriptComponents;
        public string[] gameScriptTypes;
        public Case[] cases;
    }
    static string OutputDir { get { return Path.GetFullPath(Path.Combine(Application.dataPath, "../../unity-baselines/prefab-layout")); } }
    static string NodePath(Transform node, Transform root)
    {
        return node == root ? node.name : NodePath(node.parent, root) + "/" + node.name;
    }
    static GameObject Instantiate()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (!prefab) throw new Exception("Failed to import original prefab");
        var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        root.SetActive(true);
        foreach (var behaviour in root.GetComponentsInChildren<MonoBehaviour>(true))
            if (behaviour) behaviour.enabled = false;
        foreach (var animator in root.GetComponentsInChildren<Animator>(true))
        {
            animator.Rebind();
            animator.Update(0f);
            animator.enabled = false;
        }
        return root;
    }
    static Case Measure(string label, float seconds, bool align, Camera camera)
    {
        var root = Instantiate();
        try
        {
            var systems = root.GetComponentsInChildren<ParticleSystem>(true);
            // Separate explicit control case: mimic the preview's group alignment.
            // The authored case never writes a node transform.
            if (align)
            {
                var visible = new HashSet<Transform>(systems.Where(ps => ps.GetComponent<ParticleSystemRenderer>().enabled).Select(ps => ps.transform));
                foreach (var ps in systems)
                {
                    if (!visible.Contains(ps.transform)) continue;
                    bool nested = false;
                    for (var parent = ps.transform.parent; parent && parent != root.transform; parent = parent.parent)
                        if (visible.Contains(parent)) { nested = true; break; }
                    if (!nested) ps.transform.localPosition = Vector3.zero;
                }
            }
            foreach (var ps in systems) ps.Simulate(seconds, false, true, true);
            // Produce a positional reference with a known built-in shader. The
            // original shader names/support are still measured below. This image
            // is not a color/blend parity reference for the game's MRT pipeline.
            var original = new Dictionary<ParticleSystemRenderer, Material>();
            var debug = new Material(Shader.Find("Legacy Shaders/Particles/Additive"));
            debug.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/KirakiraLayout/tex_kirakira_01.png"));
            debug.SetColor("_TintColor", new Color(2, 2, 2, 1));
            foreach (var ps in systems)
            {
                var renderer = ps.GetComponent<ParticleSystemRenderer>();
                original.Add(renderer, renderer.sharedMaterial);
                if (renderer.enabled) renderer.sharedMaterial = debug;
            }
            camera.orthographicSize = align ? 4f : 65f;
            camera.transform.position = new Vector3(0, align ? 512f : 568.5f, -20f);
            camera.transform.rotation = Quaternion.identity;
            var target = new RenderTexture(1400, 1000, 24, RenderTextureFormat.ARGB32);
            camera.targetTexture = target;
            camera.Render();
            var image = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
            var previous = RenderTexture.active;
            RenderTexture.active = target;
            image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
            image.Apply();
            var imageName = label + "-" + seconds.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + ".png";
            File.WriteAllBytes(Path.Combine(OutputDir, imageName), image.EncodeToPNG());
            RenderTexture.active = previous;
            camera.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(image);
            target.Release();
            UnityEngine.Object.DestroyImmediate(target);
            var samples = new List<SystemSample>();
            foreach (var ps in systems)
            {
                var renderer = ps.GetComponent<ParticleSystemRenderer>();
                var material = original[renderer];
                var sample = new SystemSample {
                    path = NodePath(ps.transform, root.transform),
                    localPosition = ps.transform.localPosition,
                    worldPosition = ps.transform.position,
                    localScale = ps.transform.localScale,
                    worldScale = ps.transform.lossyScale,
                    simulationSpace = ps.main.simulationSpace.ToString(),
                    renderMode = renderer.renderMode.ToString(),
                    rendererEnabled = renderer.enabled,
                    shader = material && material.shader ? material.shader.name : "missing",
                    shaderSupported = material && material.shader && material.shader.isSupported,
                    count = ps.particleCount,
                    nativeRendererBounds = renderer.bounds
                };
                var particles = new ParticleSystem.Particle[ps.particleCount];
                int count = ps.GetParticles(particles);
                if (count > 0)
                {
                    var min = new Vector3(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
                    var max = new Vector3(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
                    var sum = Vector3.zero;
                    for (int i = 0; i < count; i++)
                    {
                        var world = ps.main.simulationSpace == ParticleSystemSimulationSpace.Local ? ps.transform.TransformPoint(particles[i].position) : particles[i].position;
                        min = Vector3.Min(min, world); max = Vector3.Max(max, world); sum += world;
                    }
                    sample.particleWorldMin = min; sample.particleWorldMax = max; sample.particleWorldMean = sum / count;
                    if (renderer.enabled)
                    {
                        var baked = new Mesh();
                        renderer.BakeMesh(baked, camera, false);
                        sample.bakedVertexCount = baked.vertexCount;
                        sample.bakedLocalBounds = baked.bounds;
                        renderer.BakeMesh(baked, camera, true);
                        sample.bakedTransformedBounds = baked.bounds;
                        UnityEngine.Object.DestroyImmediate(baked);
                    }
                }
                samples.Add(sample);
                renderer.sharedMaterial = material;
            }
            UnityEngine.Object.DestroyImmediate(debug);
            return new Case { name = label, seconds = seconds, image = imageName, systems = samples.ToArray() };
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }
    public static void Run()
    {
        try
        {
            Directory.CreateDirectory(OutputDir);
            if (Application.unityVersion != "2022.3.21f1") throw new Exception("Unexpected editor version");
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null) throw new Exception("A graphics device is required for native BakeMesh/render validation");
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var inspection = Instantiate();
            var scripts = inspection.GetComponentsInChildren<MonoBehaviour>(true).Where(b => b).ToArray();
            var types = scripts.Select(b => b.GetType().FullName).Distinct().ToArray();
            int scriptCount = scripts.Length;
            UnityEngine.Object.DestroyImmediate(inspection);
            var cameraObject = new GameObject("Layout reference camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.035f, 0.045f, 0.05f, 1);
            camera.nearClipPlane = 0.1f; camera.farClipPlane = 100f;
            var output = new Output {
                unityVersion = Application.unityVersion,
                graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                prefabSha256 = BitConverter.ToString(System.Security.Cryptography.SHA256.Create().ComputeHash(File.ReadAllBytes(PrefabPath))).Replace("-", "").ToLowerInvariant(),
                gameScriptComponents = scriptCount, gameScriptTypes = types,
                caveat = "Original prefab/Animator; exported game scripts are empty and disabled. Reference PNG uses a built-in additive shader, not the original game blend/MRT pipeline. Native particle/BakeMesh positions, not color parity, are tested.",
                cases = new [] { Measure("authored", 1f/60f, false, camera), Measure("authored", 1f, false, camera), Measure("authored", 3f, false, camera), Measure("aligned-control", 3f, true, camera) }
            };
            File.WriteAllText(Path.Combine(OutputDir, "unity-2022.3.21f1.json"), JsonUtility.ToJson(output, true));
            UnityEngine.Object.DestroyImmediate(cameraObject);
            Debug.Log("NATSUME_PREFAB_LAYOUT_COMPLETE " + OutputDir);
        }
        catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
    }
}
