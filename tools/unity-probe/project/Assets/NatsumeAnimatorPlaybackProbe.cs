#if UNITY_EDITOR
using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;

/** Measures player-loop clocks, renderer culling and animation messages. */
public sealed class NatsumeAnimatorPlaybackProbe : MonoBehaviour {
    [Serializable] public class Sample { public int frame,events; public float time,x,y,color; public bool visible; public string state; }
    [Serializable] public class Case { public int mode,culling; public string label; public bool rendered; public List<Sample> samples=new List<Sample>(); [NonSerialized] public Animator animator; [NonSerialized] public Renderer renderer; [NonSerialized] public NatsumePlaybackReceiver receiver; }
    [Serializable] public class Output { public string unityVersion; public List<Case> cases=new List<Case>(); public List<Clock> clocks=new List<Clock>(); }
    [Serializable] public class Clock { public int frame,physicsSteps; public float scaled,unscaled,fixedDelta; }
    Output output=new Output(); Camera view; int frame=-4,physicsSteps;
    public static void Run() {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        EditorSettings.enterPlayModeOptionsEnabled=true;
        EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
        new GameObject("animator-playback").AddComponent<NatsumeAnimatorPlaybackProbe>();
        EditorApplication.EnterPlaymode();
    }
    void Start() {
        try {
            output.unityVersion=Application.unityVersion;
            Time.captureFramerate=60;Time.fixedDeltaTime=.02f;
            var camera=new GameObject("camera");view=camera.AddComponent<Camera>();view.orthographic=true;view.orthographicSize=10;view.transform.position=new Vector3(0,0,-10);view.targetTexture=new RenderTexture(64,64,16);
            string path="Assets/AnimatorPlayback.controller";AssetDatabase.DeleteAsset(path);
            var controller=AnimatorController.CreateAnimatorControllerAtPath(path);
            var clip=new AnimationClip();clip.SetCurve("target",typeof(Transform),"localPosition.x",AnimationCurve.Linear(0,0,1,4));
            clip.SetCurve("target/colorSprite",typeof(SpriteRenderer),"m_Color.r",AnimationCurve.Linear(0,.2f,1,.8f));
            var events=new List<AnimationEvent>();foreach(float at in new[]{0f,.1f,.2f,.3f,.4f,.5f,.6f,.7f,.8f,.9f,1f})events.Add(new AnimationEvent{time=at,functionName="ReceivePlaybackEvent"});AnimationUtility.SetAnimationEvents(clip,events.ToArray());
            var settings=AnimationUtility.GetAnimationClipSettings(clip);settings.loopTime=true;AnimationUtility.SetAnimationClipSettings(clip,settings);AssetDatabase.AddObjectToAsset(clip,controller);
            var state=controller.layers[0].stateMachine.AddState("A");state.motion=clip;controller.layers[0].stateMachine.defaultState=state;
            foreach(int mode in new[]{0,1,2})foreach(int culling in new[]{0,1,2})foreach(bool rendered in new[]{false,true}) {
                var root=new GameObject("case");root.transform.position=new Vector3(rendered?0:100,0,0);
                var target=GameObject.CreatePrimitive(PrimitiveType.Cube);target.name="target";target.transform.SetParent(root.transform,false);
                var colorSprite=new GameObject("colorSprite");colorSprite.transform.SetParent(target.transform,false);colorSprite.AddComponent<SpriteRenderer>();
                var receiver=root.AddComponent<NatsumePlaybackReceiver>();var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=controller;animator.updateMode=(AnimatorUpdateMode)mode;animator.cullingMode=(AnimatorCullingMode)culling;
                output.cases.Add(new Case{mode=mode,culling=culling,rendered=rendered,animator=animator,renderer=target.GetComponent<Renderer>(),receiver=receiver});
            }
            foreach(bool conditional in new[]{false,true}) {
                string entryPath="Assets/AnimatorPlaybackEntry"+conditional+".controller";AssetDatabase.DeleteAsset(entryPath);
                var ec=AnimatorController.CreateAnimatorControllerAtPath(entryPath);ec.AddParameter("go",AnimatorControllerParameterType.Bool);
                var sm=ec.layers[0].stateMachine;var ea=sm.AddState("A");ea.motion=clip;sm.defaultState=ea;var eb=sm.AddState("B");eb.motion=clip;var et=sm.AddEntryTransition(eb);if(conditional)et.AddCondition(AnimatorConditionMode.IfNot,0,"go");
                var root=new GameObject("entry");var target=GameObject.CreatePrimitive(PrimitiveType.Cube);target.name="target";target.transform.SetParent(root.transform,false);var colorSprite=new GameObject("colorSprite");colorSprite.transform.SetParent(target.transform,false);colorSprite.AddComponent<SpriteRenderer>();
                var receiver=root.AddComponent<NatsumePlaybackReceiver>();var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=ec;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;
                output.cases.Add(new Case{label="entry-"+conditional,animator=animator,renderer=target.GetComponent<Renderer>(),receiver=receiver,rendered=true});
            }
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
    }
    void FixedUpdate(){physicsSteps++;}
    void Update(){ if(frame==20)Time.timeScale=.5f;if(frame==40)Time.timeScale=0;if(frame==50)Time.timeScale=1;
        if(frame==10||frame==30)foreach(var c in output.cases)c.animator.transform.position=new Vector3((frame==10?!c.rendered:c.rendered)?0:100,0,0);
    }
    void LateUpdate(){
        if(frame>=0){
            output.clocks.Add(new Clock{frame=frame,scaled=Time.deltaTime,unscaled=Time.unscaledDeltaTime,physicsSteps=physicsSteps,fixedDelta=Time.fixedDeltaTime});
            foreach(var c in output.cases){var target=c.animator.transform.Find("target");c.samples.Add(new Sample{frame=frame,time=c.animator.GetCurrentAnimatorStateInfo(0).normalizedTime,x=target.localPosition.x,y=target.localPosition.y,color=target.Find("colorSprite").GetComponent<SpriteRenderer>().color.r,visible=c.renderer.isVisible,state=c.animator.GetCurrentAnimatorStateInfo(0).IsName("Base Layer.B")?"B":"A",events=c.receiver.events});}
        }
        physicsSteps=0;frame++;
        if(frame>70){Time.timeScale=1;var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));EditorApplication.Exit(0);}
    }
}
public sealed class NatsumePlaybackReceiver : MonoBehaviour { public int events;public void ReceivePlaybackEvent(AnimationEvent e){events++;} }
#endif
