#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
public sealed class NatsumeParticleCullingPlaybackProbe:MonoBehaviour{
 [Serializable]public class Frame{public int frame,count;public float time,beforeTime,delta,unscaledDelta,gameTime;public bool visible;}
 [Serializable]public class Case{public float fixedDelta,speed=1;public int sleepMilliseconds,mode;public bool loop,unscaled;public List<Frame> frames=new List<Frame>();}
 [Serializable]public class Output{public string unityVersion;public List<Case> cases=new List<Case>();}
 readonly Output output=new Output();ParticleSystem ps;Camera camera;GameObject root;int index,frame;Material material;
 public static void Run(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;new GameObject("particle-culling").AddComponent<NatsumeParticleCullingPlaybackProbe>();EditorApplication.EnterPlaymode();}
 void Start(){Time.captureFramerate=60;Time.timeScale=0.5f;output.unityVersion=Application.unityVersion;camera=new GameObject("camera").AddComponent<Camera>();camera.transform.position=new Vector3(0,0,-10);camera.orthographic=true;camera.orthographicSize=2;camera.targetTexture=new RenderTexture(32,32,24);camera.targetTexture.Create();material=new Material(Shader.Find("Particles/Standard Unlit"));foreach(float fixedDelta in new[]{0.01f,0.02f,0.04f})foreach(int mode in new[]{0,1,2,3})foreach(bool loop in new[]{false,true})foreach(bool unscaled in new[]{false,true})output.cases.Add(new Case{fixedDelta=fixedDelta,mode=mode,loop=loop,unscaled=unscaled});foreach(float fixedDelta in new[]{0.01f,0.02f,0.04f})foreach(float speed in new[]{0.5f,1f,2f})foreach(bool loop in new[]{false,true})foreach(bool unscaled in new[]{false,true})output.cases.Add(new Case{fixedDelta=fixedDelta,mode=1,speed=speed,sleepMilliseconds=10,loop=loop,unscaled=unscaled});}
 void LateUpdate(){try{var c=output.cases[index];if(frame==0){Time.fixedDeltaTime=c.fixedDelta;root=new GameObject("source");ps=root.AddComponent<ParticleSystem>();ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.loop=c.loop;m.duration=2;m.startLifetime=2;m.startSpeed=0;m.cullingMode=(ParticleSystemCullingMode)c.mode;m.useUnscaledTime=c.unscaled;m.simulationSpeed=c.speed;var e=ps.emission;e.rateOverTime=30;var s=ps.shape;s.enabled=false;ps.GetComponent<ParticleSystemRenderer>().sharedMaterial=material;ps.Play(false);}
  var beforeTime=ps.time;camera.transform.position=new Vector3(frame>=10&&frame<30?100:0,0,-10);camera.Render();
  c.frames.Add(new Frame{frame=frame,count=ps.particleCount,time=ps.time,beforeTime=beforeTime,delta=Time.deltaTime,unscaledDelta=Time.unscaledDeltaTime,gameTime=Time.time,visible=ps.GetComponent<ParticleSystemRenderer>().isVisible});
  if(c.sleepMilliseconds>0)System.Threading.Thread.Sleep(c.sleepMilliseconds);
  if(++frame==50){DestroyImmediate(root);frame=0;if(++index==output.cases.Count){var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}}
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
#endif
