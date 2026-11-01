#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class NatsumeParticleForcePlaybackProbe : MonoBehaviour
{
    [Serializable] public class Case {
        public int switches; public float speed,size,force,dt,mass; public Vector3 velocity;
        [NonSerialized] public Rigidbody body;
    }
    [Serializable] public class Output { public string unityVersion; public List<Case> cases=new List<Case>(); }
    readonly Output output=new Output();int frames;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;
        EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("particle-force-playback").AddComponent<NatsumeParticleForcePlaybackProbe>();
        EditorApplication.EnterPlaymode();
    }
    void Start() {
        Time.captureFramerate=60;Time.fixedDeltaTime=1f/60;output.unityVersion=Application.unityVersion;
        for(int switches=0;switches<8;switches++)foreach(float speed in new[]{5f,10f,20f})foreach(float size in new[]{0.1f,0.2f,0.4f}) {
            float offset=output.cases.Count*10;
            var target=new GameObject("force-target");var box=target.AddComponent<BoxCollider>();box.size=new Vector3(4,1,4);target.transform.position=new Vector3(offset,-0.5f,0);
            var body=target.AddComponent<Rigidbody>();body.mass=2;body.useGravity=false;body.constraints=RigidbodyConstraints.FreezeRotation;
            var go=new GameObject("force-particle");var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var main=ps.main;main.playOnAwake=false;main.loop=false;main.gravityModifier=0;main.simulationSpace=ParticleSystemSimulationSpace.World;
            main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
            var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;
            var c=ps.collision;c.enabled=true;c.type=ParticleSystemCollisionType.World;c.enableDynamicColliders=true;
            c.radiusScale=0.5f;c.dampen=0;c.bounce=1;c.lifetimeLoss=0;c.minKillSpeed=0;c.maxKillSpeed=10000;c.sendCollisionMessages=true;
            c.colliderForce=0.8f;c.multiplyColliderForceByParticleSize=(switches&1)!=0;c.multiplyColliderForceByParticleSpeed=(switches&2)!=0;c.multiplyColliderForceByCollisionAngle=(switches&4)!=0;
            ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            ps.Play(false);ps.Emit(new ParticleSystem.EmitParams{position=new Vector3(offset,0.01f+size*0.25f,0),velocity=new Vector3(speed*0.6f,-speed*0.8f,0),startLifetime=4,startSize=size,randomSeed=12345},1);
            output.cases.Add(new Case{switches=switches,speed=speed,size=size,force=0.8f,dt=1f/60,mass=2,body=body});
        }
        Physics.SyncTransforms();
    }
    void LateUpdate() {
        if(++frames<12)return;
        foreach(var c in output.cases)c.velocity=c.body.velocity;
        var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);
    }
}
#endif
