#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class NatsumeParticleMainPlaybackProbe : MonoBehaviour {
 [Serializable]public class Frame{public int frame,count,childCount,callbacks;public float time;public bool exists,active,playing,emitting,stopped;}
 [Serializable]public class Case{public int action,stop;public bool child,trail,receiverDisabled;public List<Frame> frames=new List<Frame>();}
 [Serializable]public class Output{public string unityVersion;public List<Case> cases=new List<Case>();}
 readonly Output output=new Output();ParticleSystem ps,child;GameObject root;int index,frame;public int callbacks;
 public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("main-playback").AddComponent<NatsumeParticleMainPlaybackProbe>();EditorApplication.EnterPlaymode();}
 void Start(){Time.captureFramerate=60;output.unityVersion=Application.unityVersion;foreach(bool trail in new[]{false,true})foreach(int action in new[]{0,1,2,3})foreach(int stop in new[]{0,1,2})foreach(bool child in new[]{false,true})foreach(bool disabled in action==3?new[]{false,true}:new[]{false})output.cases.Add(new Case{action=action,stop=stop,child=child,trail=trail,receiverDisabled=disabled});}
 static ParticleSystem Create(GameObject go,float life){var ps=go.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.loop=false;m.duration=0.2f;m.startLifetime=life;m.startSpeed=0;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var e=ps.emission;e.rateOverTime=0;e.SetBursts(new[]{new ParticleSystem.Burst(0,1)});var s=ps.shape;s.enabled=false;return ps;}
 void LateUpdate(){try{var c=output.cases[index];
  if(frame==0){callbacks=0;root=new GameObject("source");ps=Create(root,0.1f);var m=ps.main;if(c.trail){m.startSpeed=1;var trails=ps.trails;trails.enabled=true;trails.lifetime=0.3f;trails.dieWithParticles=false;trails.minVertexDistance=0.001f;}m.stopAction=(ParticleSystemStopAction)c.action;var receiver=root.AddComponent<NatsumeParticleStopReceiver>();receiver.owner=this;receiver.enabled=!c.receiverDisabled;
   if(c.child){var go=new GameObject("child");go.transform.SetParent(root.transform);child=Create(go,0.4f);}else child=null;ps.Play(true);}
  if(frame==3&&c.stop!=0)ps.Stop(true,c.stop==1?ParticleSystemStopBehavior.StopEmitting:ParticleSystemStopBehavior.StopEmittingAndClear);
  var exists=ps!=null;var row=new Frame{frame=frame,exists=exists,active=exists&&root.activeSelf,count=exists?ps.particleCount:0,childCount=child!=null?child.particleCount:0,callbacks=callbacks,time=exists?ps.time:0,playing=exists&&ps.isPlaying,emitting=exists&&ps.isEmitting,stopped=exists&&ps.isStopped};c.frames.Add(row);
  if(++frame==40){if(root!=null)DestroyImmediate(root);frame=0;if(++index==output.cases.Count){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
public sealed class NatsumeParticleStopReceiver:MonoBehaviour{public NatsumeParticleMainPlaybackProbe owner;void OnParticleSystemStopped(){owner.callbacks++;}}
#endif
