using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.Animations;

public class NatsumeEventReceiver : MonoBehaviour {
    public static List<NatsumeEventProbe.Hit> hits;
    public static int frame;
    public void Receive(AnimationEvent e) { hits.Add(new NatsumeEventProbe.Hit{frame=frame,name=e.stringParameter,number=e.floatParameter,integer=e.intParameter,time=e.time,x=transform.localPosition.x}); }
}
public static class NatsumeEventProbe {
    [Serializable] public class Hit {public int frame,integer;public string name;public float number,time,x;}
    [Serializable] public class Case {public float duration,dt,speed,offset;public bool loop;public int lifecycle;public Hit[] hits;}
    [Serializable] public class Output {public string unityVersion;public Case[] cases;}
    static Case Measure(int index,float duration,float dt,float speed,float offset,bool loop,int lifecycle) {
        string path="Assets/EventProbe"+index+".controller";var controller=AnimatorController.CreateAnimatorControllerAtPath(path);
        var clip=new AnimationClip();clip.name="Events";clip.SetCurve("",typeof(Transform),"localPosition.x",AnimationCurve.Linear(0,0,duration,10));
        var events=new List<AnimationEvent>();
        foreach(float t in new[]{0,duration*.25f,duration*.5f,duration*.5f,duration}) {int i=events.Count;events.Add(new AnimationEvent{time=t,functionName="Receive",stringParameter="event-"+i,floatParameter=1.25f+i,intParameter=i-2,messageOptions=SendMessageOptions.RequireReceiver});}
        AnimationUtility.SetAnimationEvents(clip,events.ToArray());var settings=AnimationUtility.GetAnimationClipSettings(clip);settings.loopTime=loop;AnimationUtility.SetAnimationClipSettings(clip,settings);AssetDatabase.AddObjectToAsset(clip,controller);
        var state=controller.layers[0].stateMachine.AddState("Probe");state.motion=clip;state.speed=speed;state.cycleOffset=offset;controller.layers[0].stateMachine.defaultState=state;
        var go=new GameObject("event-probe");go.AddComponent<NatsumeEventReceiver>();var animator=go.AddComponent<Animator>();animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;animator.runtimeAnimatorController=controller;
        NatsumeEventReceiver.hits=new List<Hit>();NatsumeEventReceiver.frame=-1;
        try {animator.Rebind();animator.Play("Base Layer.Probe",0,0);animator.Update(0);
            for(int i=0;i<32;i++) {NatsumeEventReceiver.frame=i;
                if(lifecycle==1 && i==8)animator.enabled=false;if(lifecycle==1&&i==12)animator.enabled=true;
                if(lifecycle==2 && i==8)go.SetActive(false);if(lifecycle==2&&i==12)go.SetActive(true);
                if(lifecycle==3 && i==8)animator.Play("Base Layer.Probe",0,0);
                if(go.activeSelf&&animator.enabled)animator.Update(dt);
            }
            return new Case{duration=clip.length,dt=dt,speed=speed,offset=offset,loop=loop,lifecycle=lifecycle,hits=NatsumeEventReceiver.hits.ToArray()};
        }finally{UnityEngine.Object.DestroyImmediate(go);AssetDatabase.DeleteAsset(path);}
    }
    public static void Run(){try{var cases=new List<Case>();int i=0;
        foreach(float duration in new[]{.1f,.5f,1.3f})foreach(float dt in new[]{1f/60,.037f,.7f})foreach(float speed in new[]{0,.5f,1,2})foreach(float offset in new[]{0,.3f,1})foreach(bool loop in new[]{false,true})cases.Add(Measure(i++,duration,dt,speed,offset,loop,0));
        foreach(bool loop in new[]{false,true})cases.Add(Measure(i++,0,1f/60,1,0,loop,0));
        foreach(int life in new[]{1,2,3})cases.Add(Measure(i++,.5f,1f/60,1,0,true,life));
        string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/events"));Directory.CreateDirectory(output);File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));
    }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}}
}
