#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class NatsumeParticleTriggerPlaybackProbe : MonoBehaviour
{
    [Serializable] public class Event { public int frame,type,count;public Vector3 position;public string[] colliders; }
    [Serializable] public class Sample { public int frame,count,children;public Vector3 position; }
    [Serializable] public class Case {
        public int action,query;public float radius,offset,speed;public bool overlap;public Vector3 start;
        public List<Sample> samples=new List<Sample>();public List<Event> events=new List<Event>();
        [NonSerialized] public ParticleSystem system,child;
    }
    [Serializable] public class Output { public string unityVersion;public List<Case> cases=new List<Case>(); }
    readonly Output output=new Output();int startup,frame;bool begun;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("trigger-playback").AddComponent<NatsumeParticleTriggerPlaybackProbe>();EditorApplication.EnterPlaymode();
    }
    void Start(){Time.captureFramerate=50;Time.fixedDeltaTime=0.02f;output.unityVersion=Application.unityVersion;}
    void Begin() {
        for(int action=0;action<6;action++)for(int query=0;query<3;query++)foreach(float radius in new[]{0f,0.5f,1f})foreach(bool overlap in new[]{false,true})foreach(float speed in new[]{5f,200f}) {
            float offset=output.cases.Count*10;var row=new Case{action=action,query=query,radius=radius,offset=offset,overlap=overlap,speed=speed};
            var a=new GameObject("A");a.transform.position=new Vector3(offset,0,0);var ca=a.AddComponent<SphereCollider>();ca.radius=1;ca.isTrigger=true;
            var b=new GameObject("B");b.transform.position=new Vector3(offset+0.8f,0,0);var cb=b.AddComponent<SphereCollider>();cb.radius=1;cb.isTrigger=true;
            var go=new GameObject("trigger-particle");var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var main=ps.main;main.playOnAwake=false;main.loop=false;main.gravityModifier=0;main.simulationSpace=ParticleSystemSimulationSpace.World;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
            var em=ps.emission;em.enabled=false;var shape=ps.shape;shape.enabled=false;ps.GetComponent<ParticleSystemRenderer>().enabled=false;
            var t=ps.trigger;t.enabled=true;t.inside=action==1?ParticleSystemOverlapAction.Kill:ParticleSystemOverlapAction.Callback;t.outside=action==2?ParticleSystemOverlapAction.Kill:ParticleSystemOverlapAction.Callback;
            t.enter=action==3?ParticleSystemOverlapAction.Kill:ParticleSystemOverlapAction.Callback;t.exit=action==4?ParticleSystemOverlapAction.Kill:ParticleSystemOverlapAction.Callback;
            if(action==5){t.inside=t.outside=t.enter=t.exit=ParticleSystemOverlapAction.Ignore;}
            t.radiusScale=radius;t.colliderQueryMode=(ParticleSystemColliderQueryMode)query;t.SetCollider(0,null);t.SetCollider(1,ca);t.SetCollider(2,overlap?cb:null);t.SetCollider(3,overlap?ca:null);
            var childObject=new GameObject("child");childObject.transform.SetParent(go.transform);var child=childObject.AddComponent<ParticleSystem>();child.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var cm=child.main;cm.playOnAwake=false;cm.loop=false;cm.startLifetime=4;cm.startSpeed=0;cm.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
            var ce=child.emission;ce.enabled=false;ce.SetBursts(new[]{new ParticleSystem.Burst(0,1)});child.GetComponent<ParticleSystemRenderer>().enabled=false;
            var sub=ps.subEmitters;sub.enabled=true;sub.AddSubEmitter(child,ParticleSystemSubEmitterType.Trigger,ParticleSystemSubEmitterProperties.InheritNothing);
            row.system=ps;row.child=child;var recorder=go.AddComponent<NatsumeParticleTriggerRecorder>();recorder.row=row;recorder.startFrame=Time.frameCount;
            row.start=new Vector3(offset-1.37f,0,0);ps.Play(false);ps.Emit(new ParticleSystem.EmitParams{position=row.start,velocity=new Vector3(speed,0,0),startLifetime=4,startSize=0.2f,randomSeed=12345},1);
            output.cases.Add(row);
        }
        Physics.SyncTransforms();
    }
    void LateUpdate() {
        try {
            if(!begun){if(++startup<3)return;Begin();begun=true;return;}
            frame++;var p=new ParticleSystem.Particle[1];
            foreach(var c in output.cases){int count=c.system.GetParticles(p);c.samples.Add(new Sample{frame=frame,count=count,children=c.child.particleCount,position=count>0?p[0].position-new Vector3(c.offset,0,0):Vector3.zero});}
            if(frame<38)return;var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
    }
}
public sealed class NatsumeParticleTriggerRecorder : MonoBehaviour
{
    public NatsumeParticleTriggerPlaybackProbe.Case row;public int startFrame;
    readonly List<ParticleSystem.Particle> particles=new List<ParticleSystem.Particle>();
    void OnParticleTrigger() {
        for(int type=0;type<4;type++) {
            var kind=(ParticleSystemTriggerEventType)type;int count;var colliders=new List<string>();
            if(row.query!=0&&(kind==ParticleSystemTriggerEventType.Inside||kind==ParticleSystemTriggerEventType.Enter)) {
                ParticleSystem.ColliderData data;count=row.system.GetTriggerParticles(kind,particles,out data);
                if(count>0)for(int i=0;i<data.GetColliderCount(0);i++)colliders.Add(data.GetCollider(0,i).name);
            } else count=row.system.GetTriggerParticles(kind,particles);
            if(count>0)row.events.Add(new NatsumeParticleTriggerPlaybackProbe.Event{frame=Time.frameCount-startFrame,type=type,count=count,position=particles[0].position-new Vector3(row.offset,0,0),colliders=colliders.ToArray()});
        }
    }
}
#endif
