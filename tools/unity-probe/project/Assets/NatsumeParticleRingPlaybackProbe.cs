#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
public sealed class NatsumeParticleRingPlaybackProbe:MonoBehaviour {
 [Serializable]public class Frame{public int frame,count,deathParticles;public float time;public float[] ages;}
 [Serializable]public class Case{public int mode;public Vector2 range;public List<Frame> frames=new List<Frame>();}
 [Serializable]public class Output{public string unityVersion;public List<Case> cases=new List<Case>();}
 Output output=new Output();ParticleSystem ps,target;int index,frame;
 public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("ring-playback").AddComponent<NatsumeParticleRingPlaybackProbe>();EditorApplication.EnterPlaymode();}
 void Start(){Time.captureFramerate=60;output.unityVersion=Application.unityVersion;
  ps=new GameObject("source").AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.duration=1;m.loop=true;m.startLifetime=0.1f;m.startSpeed=0;m.maxParticles=3;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var e=ps.emission;e.enabled=false;var sh=ps.shape;sh.enabled=false;
  target=new GameObject("death").AddComponent<ParticleSystem>();target.transform.SetParent(ps.transform);target.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var tm=target.main;tm.playOnAwake=false;tm.startLifetime=100;tm.startSpeed=0;var te=target.emission;te.rateOverTime=0;te.SetBursts(new[]{new ParticleSystem.Burst(0,1)});te.enabled=false;var sub=ps.subEmitters;sub.enabled=true;sub.AddSubEmitter(target,ParticleSystemSubEmitterType.Death,ParticleSystemSubEmitterProperties.InheritNothing);
  foreach(int mode in new[]{0,1,2})foreach(Vector2 range in new[]{new Vector2(0,1),new Vector2(0.2f,0.6f),new Vector2(0.5f,0.5f)})output.cases.Add(new Case{mode=mode,range=range});
 }
 void LateUpdate(){try{
  var c=output.cases[index];
  if(frame==0){ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.ringBufferMode=(ParticleSystemRingBufferMode)c.mode;m.ringBufferLoopRange=c.range;ps.Play(false);ps.Emit(3);}
  if(frame==10||frame==15)ps.Emit(1);if(frame==20)ps.Emit(2);
  var p=new ParticleSystem.Particle[3];var count=ps.GetParticles(p);var row=new Frame{frame=frame,count=count,time=ps.time,deathParticles=target.particleCount,ages=new float[count]};for(int i=0;i<count;i++)row.ages[i]=p[i].startLifetime-p[i].remainingLifetime;c.frames.Add(row);
  if(++frame==30){frame=0;if(++index==output.cases.Count){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
#endif
