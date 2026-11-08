using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Playables;
using UnityEditor;

// Original prefab simulation; game-script logic and platform-specific shader
// colors are deliberately reported as unverified instead of being guessed.
public static class NatsumeCorpusProbe
{
    [Serializable] public class Entry { public int index; public string bundle,source,sourceSha256,guid; }
    [Serializable] public class Input { public string inventorySha256,caveat; public Entry[] entries; }
    [Serializable] public class SystemRow { public string path; public int count,vertices; public bool active,rendererEnabled,finite; public float time; public Vector3 min,max; }
    [Serializable] public class NodeRow { public string path; public bool active; public Vector3 position,scale; public Quaternion rotation; }
    [Serializable] public class Frame { public float seconds; public string image; public SystemRow[] systems; public NodeRow[] nodes; public string[] unsupportedShaders; public Matrix4x4 view,projection; }
    [Serializable] public class Result { public int index; public string bundle,source,sourceSha256,error; public string[] gameScriptTypes; public List<Frame> frames=new List<Frame>(); }
    [Serializable] public class Output { public string unityVersion,timestamp,graphicsDevice,inventorySha256,caveat; public int expected,processed; public List<Result> entries=new List<Result>(); }
    static string PathOf(Transform node,Transform root) { return node==root?"":PathOf(node.parent,root)+(node.parent==root?"":"/")+node.name; }
    static bool Finite(float x) { return !float.IsNaN(x)&&!float.IsInfinity(x); }
    static Frame Capture(GameObject root,Camera camera,float time,string path)
    {
        Canvas.ForceUpdateCanvases();
        var systems=root.GetComponentsInChildren<ParticleSystem>(true);
        var rows=new List<SystemRow>(); var bounds=new Bounds(root.transform.position,Vector3.one); bool haveBounds=false;
        foreach(var ps in systems) {
            var particles=new ParticleSystem.Particle[ps.particleCount];ps.GetParticles(particles);
            var renderer=ps.GetComponent<ParticleSystemRenderer>(); var row=new SystemRow { path=PathOf(ps.transform,root.transform),count=particles.Length,active=ps.gameObject.activeInHierarchy,rendererEnabled=renderer&&renderer.enabled,time=ps.time,finite=true };
            if(particles.Length>0) {
                row.min=Vector3.positiveInfinity;row.max=Vector3.negativeInfinity;
                foreach(var particle in particles) { row.min=Vector3.Min(row.min,particle.position);row.max=Vector3.Max(row.max,particle.position);row.finite&=Finite(particle.position.x)&&Finite(particle.position.y)&&Finite(particle.position.z)&&Finite(particle.remainingLifetime); }
            }
            if(renderer&&renderer.enabled&&ps.gameObject.activeInHierarchy) {
                if(!haveBounds) {bounds=renderer.bounds;haveBounds=true;} else bounds.Encapsulate(renderer.bounds);
                var mesh=new Mesh();renderer.BakeMesh(mesh,camera,true);row.vertices=mesh.vertexCount;UnityEngine.Object.DestroyImmediate(mesh);
            }
            rows.Add(row);
        }
        foreach(var renderer in root.GetComponentsInChildren<Renderer>(true)) if(renderer.enabled&&renderer.gameObject.activeInHierarchy) {if(!haveBounds){bounds=renderer.bounds;haveBounds=true;}else bounds.Encapsulate(renderer.bounds);}
        camera.transform.position=new Vector3(bounds.center.x,bounds.center.y,bounds.center.z-1000);
        camera.orthographicSize=Mathf.Max(.1f,Mathf.Max(bounds.extents.y,bounds.extents.x/camera.aspect)*1.1f);
        camera.nearClipPlane=.01f;camera.farClipPlane=2000f;
        var target=new RenderTexture(640,360,24,RenderTextureFormat.ARGB32);camera.targetTexture=target;
        camera.Render();var previous=RenderTexture.active;RenderTexture.active=target;
        var image=new Texture2D(640,360,TextureFormat.RGBA32,false);image.ReadPixels(new Rect(0,0,640,360),0,0);image.Apply();File.WriteAllBytes(path,image.EncodeToPNG());
        RenderTexture.active=previous;camera.targetTexture=null;UnityEngine.Object.DestroyImmediate(image);UnityEngine.Object.DestroyImmediate(target);
        return new Frame { seconds=time,image=System.IO.Path.GetFileName(path),systems=rows.ToArray(),nodes=root.GetComponentsInChildren<Transform>(true).Select(t=>new NodeRow{path=PathOf(t,root.transform),active=t.gameObject.activeSelf,position=t.localPosition,scale=t.localScale,rotation=t.localRotation}).ToArray(),unsupportedShaders=root.GetComponentsInChildren<Renderer>(true).SelectMany(r=>r.sharedMaterials).Where(m=>!m||!m.shader||!m.shader.isSupported).Select(m=>m&&m.shader?m.shader.name:"missing shader").Distinct().ToArray(),view=camera.worldToCameraMatrix,projection=camera.projectionMatrix };
    }
    public static void Run()
    {
        var output=new Output {unityVersion=Application.unityVersion,timestamp=DateTime.UtcNow.ToString("o"),graphicsDevice=SystemInfo.graphicsDeviceName,caveat="Original prefab behavior with exported game scripts disabled. Images preserve source imported shaders; unsupported platform programs and Overlay Canvas are not color parity references. Camera matrices and local node poses are recorded."};
        string directory=Environment.GetEnvironmentVariable("NATSUME_CORPUS_OUTPUT");
        try {
            if(string.IsNullOrEmpty(directory))throw new Exception("NATSUME_CORPUS_OUTPUT is required");
            Directory.CreateDirectory(directory);var input=JsonUtility.FromJson<Input>(File.ReadAllText(Application.dataPath+"/capture-input.json"));
            output.expected=input.entries.Length;output.inventorySha256=input.inventorySha256;
            int limit=0;int.TryParse(Environment.GetEnvironmentVariable("NATSUME_CORPUS_LIMIT"),out limit);
            foreach(var entry in input.entries.Take(limit>0?limit:input.entries.Length)) {
                var result=new Result {index=entry.index,bundle=entry.bundle,source=entry.source,sourceSha256=entry.sourceSha256};GameObject instance=null,view=null;
                try {
                    string asset=AssetDatabase.GUIDToAssetPath(entry.guid);var prefab=AssetDatabase.LoadAssetAtPath<GameObject>(asset);if(!prefab)throw new Exception("Original prefab failed to import: "+asset);
                    instance=(GameObject)PrefabUtility.InstantiatePrefab(prefab);instance.SetActive(true);
                    var scripts=instance.GetComponentsInChildren<MonoBehaviour>(true).Where(b=>b&&b.GetType().Namespace!=null&&b.GetType().Namespace.StartsWith("Sekai")).ToArray();result.gameScriptTypes=scripts.Select(b=>b.GetType().FullName).Distinct().ToArray();foreach(var script in scripts)script.enabled=false;
                    view=new GameObject("capture camera");var camera=view.AddComponent<Camera>();camera.orthographic=true;camera.aspect=640f/360;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.clear;
                    var animators=instance.GetComponentsInChildren<Animator>(true);foreach(var animator in animators){animator.Rebind();animator.Update(0);}
                    var directors=instance.GetComponentsInChildren<PlayableDirector>(true);foreach(var director in directors)if(director.playOnAwake){director.timeUpdateMode=DirectorUpdateMode.Manual;director.Play();director.Evaluate();}
                    var systems=instance.GetComponentsInChildren<ParticleSystem>(true);var roots=systems.Where(p=>!p.transform.parent||!p.transform.parent.GetComponentInParent<ParticleSystem>()).ToArray();foreach(var ps in roots)ps.Play(true);
                    float horizon=Mathf.Max(1,systems.Length==0?1:systems.Max(p=>p.main.startDelay.constantMax+p.main.duration+p.main.startLifetime.constantMax));horizon=Mathf.Min(60,horizon);
                    var times=new[]{0,1f/60,.25f,.5f,1f,horizon}.Distinct().OrderBy(t=>t).ToArray();float current=0;
                    foreach(float time in times) {
                        while(current+1e-6f<time){float dt=Mathf.Min(1f/60,time-current);foreach(var animator in animators)if(animator&&animator.enabled&&animator.gameObject.activeInHierarchy)animator.Update(dt);foreach(var director in directors)if(director&&director.state==PlayState.Playing){director.time+=dt;director.Evaluate();}foreach(var ps in roots)if(ps)ps.Simulate(dt,true,false,false);current+=dt;}
                        result.frames.Add(Capture(instance,camera,time,System.IO.Path.Combine(directory,entry.index.ToString("D3")+"-"+result.frames.Count+".png")));
                    }
                } catch(Exception error){result.error=error.ToString();Debug.LogError(entry.bundle+": "+error.Message);} finally {if(instance)UnityEngine.Object.DestroyImmediate(instance);if(view)UnityEngine.Object.DestroyImmediate(view);}
                output.entries.Add(result);output.processed++;File.WriteAllText(System.IO.Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(output,true));
            }
            EditorApplication.Exit(output.entries.Any(e=>e.error!=null)?1:0);
        }catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
