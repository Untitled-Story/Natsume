#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
public sealed class NatsumeParticleClockPlaybackProbe:MonoBehaviour{
 [Serializable]public class Frame{public int frame,count;public float delta,unscaledDelta,time;}
 [Serializable]public class Case{public float timeScale,speed;public bool unscaled;public List<Frame> frames=new List<Frame>();}
 [Serializable]public class Output{public string unityVersion;public List<Case> cases=new List<Case>();}
 readonly Output output=new Output();ParticleSystem ps;int index,frame;
 public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("particle-clock").AddComponent<NatsumeParticleClockPlaybackProbe>();EditorApplication.EnterPlaymode();}
 void Start(){Time.captureFramerate=60;output.unityVersion=Application.unityVersion;foreach(float scale in new[]{0f,0.5f,1f})foreach(float speed in new[]{0.5f,1f,2f})foreach(bool unscaled in new[]{false,true})output.cases.Add(new Case{timeScale=scale,speed=speed,unscaled=unscaled});}
 void LateUpdate(){try{var c=output.cases[index];if(frame==0){Time.timeScale=c.timeScale;ps=new GameObject("source").AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.loop=true;m.duration=10;m.startLifetime=10;m.startSpeed=0;m.maxParticles=4096;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;m.useUnscaledTime=c.unscaled;m.simulationSpeed=c.speed;var e=ps.emission;e.rateOverTime=30;var s=ps.shape;s.enabled=false;ps.Play(false);}
  c.frames.Add(new Frame{frame=frame,count=ps.particleCount,time=ps.time,delta=Time.deltaTime,unscaledDelta=Time.unscaledDeltaTime});
  if(++frame==70){DestroyImmediate(ps.gameObject);frame=0;if(++index==output.cases.Count){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);return;}}
  System.Threading.Thread.Sleep(10);
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
#endif
