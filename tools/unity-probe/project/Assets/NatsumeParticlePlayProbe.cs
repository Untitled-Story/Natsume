#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class NatsumeParticlePlayProbe : MonoBehaviour {
 [Serializable] public class Row {public string scenario,action;public int frame,count;public float time;public bool active,playing,emitting,stopped;}
 [Serializable] public class Output {public string unityVersion;public List<Row> rows=new List<Row>();}
 readonly Output output=new Output();GameObject target;ParticleSystem ps;int scenario,frame;
 readonly string[] names={"running-repeat","inactive","duration-ended","stop-emitting","clear"};
 public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("explicit-play-probe").AddComponent<NatsumeParticlePlayProbe>();EditorApplication.EnterPlaymode();}
 void Start(){Time.captureFramerate=60;output.unityVersion=Application.unityVersion;}
 void Record(string action){output.rows.Add(new Row{scenario=names[scenario],action=action,frame=frame,count=ps.particleCount,time=ps.time,active=target.activeInHierarchy,playing=ps.isPlaying,emitting=ps.isEmitting,stopped=ps.isStopped});}
 void LateUpdate(){try{
  if(frame==0){target=new GameObject("source");ps=target.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.loop=false;m.duration=scenario==2?.1f:2;m.startLifetime=1;m.startSpeed=0;m.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;var em=ps.emission;em.rateOverTime=30;em.SetBursts(new[]{new ParticleSystem.Burst(0,1)});var shape=ps.shape;shape.enabled=false;if(scenario==1)target.SetActive(false);Record("created");}
  if(frame==2||(scenario==0&&frame==5)||(scenario==2&&frame==16)||((scenario==3||scenario==4)&&frame==10)){Record("before-play");ps.Play(true);Record("after-play");}
  if((scenario==3||scenario==4)&&frame==8){ps.Stop(true,scenario==3?ParticleSystemStopBehavior.StopEmitting:ParticleSystemStopBehavior.StopEmittingAndClear);Record("after-stop");}
  Record("frame");
  if(++frame==24){DestroyImmediate(target);frame=0;if(++scenario==names.Length){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
#endif
