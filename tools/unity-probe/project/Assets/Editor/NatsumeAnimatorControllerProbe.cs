using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/** Records flat controller decisions, transition clocks and layered transform poses. */
public static class NatsumeAnimatorControllerProbe
{
    [Serializable] public class Command { public int frame,type; public string parameter; public float value; }
    [Serializable] public class LayerSample { public string state,next; public float time,nextTime,progress,weight; public bool transitioning; }
    [Serializable] public class Sample { public int frame; public Vector3 position,scale; public Quaternion rotation; public bool active,trigger; public Color color; public float speed; public LayerSample[] layers; }
    [Serializable] public class Case { public string label,prefab; public Command[] commands; public List<Hit> events; public List<Sample> samples=new List<Sample>(); }
    [Serializable] public class Output { public string unityVersion; public List<Case> cases=new List<Case>(); }
    const string Folder="Assets/AnimatorControllerProbe";
    static int index;
    static List<Hit> hits;
    [Serializable] public class Hit { public int frame; public string name; }
    public static int currentFrame;
    public static void Receive(string name) { hits.Add(new Hit { frame=currentFrame, name=name }); }
    static AnimationClip Clip(string name,int mode=0,bool loop=true) {
        var clip=new AnimationClip{name=name};
        clip.SetCurve("target",typeof(Transform),"localPosition.x",AnimationCurve.Linear(0,name=="A"?1:name=="B"?10:20,1,name=="A"?5:name=="B"?14:24));
        if(mode==1) {
            clip.SetCurve("target",typeof(Transform),"localScale.x",AnimationCurve.Linear(0,1,1,3));
            clip.SetCurve("target",typeof(Transform),"localEulerAnglesRaw.z",AnimationCurve.Linear(0,0,1,name=="A"?60:120));
        }
        if(mode==2) {clip.ClearCurves();clip.SetCurve("target",typeof(Transform),"localPosition.y",AnimationCurve.Linear(0,30,1,34));}
        if(mode==3) {clip.ClearCurves();var curve=new AnimationCurve(new Keyframe(0,0),new Keyframe(.5f,1));for(int i=0;i<curve.length;i++){var k=curve[i];k.inTangent=k.outTangent=float.PositiveInfinity;curve.MoveKey(i,k);}clip.SetCurve("target",typeof(GameObject),"m_IsActive",curve);}
        if(mode==4) {
            clip.SetCurve("target",typeof(Transform),"localEulerAnglesRaw.x",AnimationCurve.Linear(0,17,1,110));
            clip.SetCurve("target",typeof(Transform),"localEulerAnglesRaw.y",AnimationCurve.Linear(0,-23,1,name=="A"?160:-90));
            clip.SetCurve("target",typeof(Transform),"localEulerAnglesRaw.z",AnimationCurve.Linear(0,35,1,name=="A"?290:170));
        }
        if(mode==5) {
            clip.SetCurve("target/sprite",typeof(SpriteRenderer),"m_Color.r",AnimationCurve.Linear(0,name=="A"?.2f:.7f,1,name=="A"?.8f:.3f));
            clip.SetCurve("target/particles",typeof(ParticleSystem),"InitialModule.startSpeed.scalar",AnimationCurve.Linear(0,name=="A"?1:10,1,name=="A"?5:14));
        }
        var settings=AnimationUtility.GetAnimationClipSettings(clip);settings.loopTime=loop;AnimationUtility.SetAnimationClipSettings(clip,settings);return clip;
    }
    static AnimatorStateTransition Edge(AnimatorState a,AnimatorState b,string parameter="go",AnimatorConditionMode condition=AnimatorConditionMode.If,float threshold=0,float duration=0) {
        var t=a.AddTransition(b);t.hasExitTime=false;t.hasFixedDuration=true;t.duration=duration;t.AddCondition(condition,threshold,parameter);return t;
    }
    static Command Cmd(int frame,string parameter,float value,int type=2){return new Command{frame=frame,parameter=parameter,value=value,type=type};}
    static void Measure(Output output,string label,Action<AnimatorController,AnimatorState[],List<Command>> configure,int mode=0,bool loop=true) {
        string stem=Folder+"/case"+(index++);
        var controller=AnimatorController.CreateAnimatorControllerAtPath(stem+".controller");
        controller.AddParameter("go",AnimatorControllerParameterType.Bool);controller.AddParameter("other",AnimatorControllerParameterType.Bool);controller.AddParameter("f",AnimatorControllerParameterType.Float);controller.AddParameter("i",AnimatorControllerParameterType.Int);controller.AddParameter("trigger",AnimatorControllerParameterType.Trigger);
        var machine=controller.layers[0].stateMachine;var states=new AnimatorState[4];
        for(int i=0;i<4;i++) {states[i]=machine.AddState(((char)('A'+i)).ToString());var clip=Clip(states[i].name,mode,loop);AssetDatabase.AddObjectToAsset(clip,controller);states[i].motion=clip;states[i].writeDefaultValues=true;}
        machine.defaultState=states[0];var commands=new List<Command>();configure(controller,states,commands);
        var go=new GameObject(label);var target=new GameObject("target");target.transform.SetParent(go.transform,false);target.transform.localPosition=new Vector3(7,11,13);
        SpriteRenderer sprite=null;ParticleSystem particles=null;
        if(mode==5){var spriteObject=new GameObject("sprite");spriteObject.transform.SetParent(target.transform,false);sprite=spriteObject.AddComponent<SpriteRenderer>();var particleObject=new GameObject("particles");particleObject.transform.SetParent(target.transform,false);particles=particleObject.AddComponent<ParticleSystem>();particles.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);var main=particles.main;main.playOnAwake=false;var emission=particles.emission;emission.enabled=false;particleObject.GetComponent<ParticleSystemRenderer>().enabled=false;}
        var animator=go.AddComponent<Animator>();animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;animator.runtimeAnimatorController=controller;
        AssetDatabase.SaveAssets();PrefabUtility.SaveAsPrefabAsset(go,stem+".prefab");go.AddComponent<NatsumeControllerEventReceiver>();
        hits=new List<Hit>();currentFrame=0;
        animator.Rebind();animator.Update(0);
        var row=new Case{label=label,prefab=stem+".prefab",commands=commands.ToArray(),events=hits};
        for(int frame=0;frame<=96;frame++) {
            currentFrame=frame;
            foreach(var command in commands)if(command.frame==frame) {
                if(command.type==0)animator.SetFloat(command.parameter,command.value);
                else if(command.type==1)animator.SetInteger(command.parameter,(int)command.value);
                else if(command.type==2)animator.SetBool(command.parameter,command.value!=0);
                else if(command.type==3)animator.SetTrigger(command.parameter);
                else if(command.type==4)animator.ResetTrigger(command.parameter);
                else if(command.type==5)animator.SetLayerWeight((int)command.value,.25f);
                else if(command.type==6)animator.Play(command.parameter,(int)command.value,0);
                else if(command.type==7)target.SetActive(command.value!=0);
            }
            if(frame>0)animator.Update(1f/60);
            var layers=new LayerSample[animator.layerCount];
            for(int li=0;li<layers.Length;li++) {
                var current=animator.GetCurrentAnimatorStateInfo(li);var next=animator.GetNextAnimatorStateInfo(li);var transition=animator.GetAnimatorTransitionInfo(li);
                string a="",b="";foreach(string name in new[]{"A","B","C","D"}){if(current.IsName(animator.GetLayerName(li)+"."+name))a=name;if(next.IsName(animator.GetLayerName(li)+"."+name))b=name;}
                layers[li]=new LayerSample{state=a,next=b,time=current.normalizedTime,nextTime=next.normalizedTime,progress=transition.normalizedTime,transitioning=animator.IsInTransition(li),weight=animator.GetLayerWeight(li)};
            }
            row.samples.Add(new Sample{frame=frame,position=target.transform.localPosition,scale=target.transform.localScale,rotation=target.transform.localRotation,active=target.activeSelf,color=sprite?sprite.color:Color.clear,speed=particles?particles.main.startSpeed.constant:0,trigger=animator.GetBool("trigger"),layers=layers});
        }
        output.cases.Add(row);UnityEngine.Object.DestroyImmediate(go);
    }
    public static void Run() {
        try {
            if(!AssetDatabase.IsValidFolder(Folder))AssetDatabase.CreateFolder("Assets","AnimatorControllerProbe");
            var output=new Output{unityVersion=Application.unityVersion};
            foreach(int type in new[]{0,1,2,3,4,5,6,7})Measure(output,"condition-"+type,(c,s,commands)=>{
                var mode=type==0?AnimatorConditionMode.Greater:type==1?AnimatorConditionMode.Less:type==2?AnimatorConditionMode.Equals:type==3?AnimatorConditionMode.NotEqual:type==5?AnimatorConditionMode.IfNot:AnimatorConditionMode.If;
                string p=type<2?"f":type<4?"i":type<6?"go":"trigger";
                var t=Edge(s[0],s[1],p,mode,type<4?2:0);if(type==7)t.AddCondition(AnimatorConditionMode.If,0,"other");
                commands.Add(Cmd(5,p,type==1?1:type==5?0:3,type<2?0:type<4?1:type<6?2:3));
                if(type==7)commands.Add(Cmd(12,"other",1));
            });
            foreach(float duration in new[]{0f,.1f,.37f})foreach(bool fixedDuration in new[]{false,true})foreach(float offset in new[]{0f,.3f})Measure(output,"blend-"+duration+"-"+fixedDuration+"-"+offset,(c,s,commands)=>{var t=Edge(s[0],s[1],duration:duration);t.hasFixedDuration=fixedDuration;t.offset=offset;commands.Add(Cmd(5,"go",1));},1);
            foreach(float exit in new[]{0f,.25f,.75f,1.25f})foreach(bool loop in new[]{false,true})Measure(output,"exit-"+exit+"-"+loop,(c,s,commands)=>{var t=s[0].AddTransition(s[1]);t.hasExitTime=true;t.exitTime=exit;t.duration=0;},0,loop);
            foreach(int interruption in new[]{0,1,2,3,4})foreach(bool ordered in new[]{false,true})Measure(output,"interrupt-"+interruption+"-"+ordered,(c,s,commands)=>{var t=Edge(s[0],s[1],duration:.5f);t.interruptionSource=(TransitionInterruptionSource)interruption;t.orderedInterruption=ordered;Edge(s[0],s[2],"other");Edge(s[1],s[3],"other");commands.Add(Cmd(5,"go",1));commands.Add(Cmd(12,"other",1));});
            foreach(int kind in new[]{0,1,2,3,4})Measure(output,"routing-"+kind,(c,s,commands)=>{var machine=c.layers[0].stateMachine;if(kind==0){var e=machine.AddEntryTransition(s[1]);e.AddCondition(AnimatorConditionMode.IfNot,0,"go");}else if(kind==1){var t=machine.AddAnyStateTransition(s[2]);t.hasExitTime=false;t.duration=0;t.AddCondition(AnimatorConditionMode.If,0,"go");commands.Add(Cmd(5,"go",1));}else if(kind==2){Edge(s[0],s[1]).mute=true;Edge(s[0],s[2]);commands.Add(Cmd(5,"go",1));}else if(kind==3){Edge(s[0],s[1]);Edge(s[0],s[2]).solo=true;commands.Add(Cmd(5,"go",1));}else{var t=s[0].AddExitTransition();t.hasExitTime=false;t.duration=0;t.AddCondition(AnimatorConditionMode.If,0,"go");commands.Add(Cmd(5,"go",1));}});
            foreach(int kind in new[]{0,1,2})Measure(output,"state-parameter-"+kind,(c,s,commands)=>{if(kind==0){s[0].speedParameter="f";s[0].speedParameterActive=true;}if(kind==1){s[0].cycleOffsetParameter="f";s[0].cycleOffsetParameterActive=true;}if(kind==2){s[0].timeParameter="f";s[0].timeParameterActive=true;}commands.Add(Cmd(5,"f",.3f,0));commands.Add(Cmd(20,"f",1.3f,0));commands.Add(Cmd(35,"f",-.2f,0));});
            foreach(bool additive in new[]{false,true})foreach(float weight in new[]{0f,.25f,.5f,1f})foreach(int kind in new[]{0,1,2})Measure(output,"layer-"+additive+"-"+weight+"-"+kind,(c,s,commands)=>{c.AddLayer("Upper");var layers=c.layers;var layer=layers[1];layer.defaultWeight=weight;layer.blendingMode=additive?AnimatorLayerBlendingMode.Additive:AnimatorLayerBlendingMode.Override;var upper=layer.stateMachine.AddState("B");upper.writeDefaultValues=true;var clip=Clip("B",kind==0?1:kind==1?2:3);AssetDatabase.AddObjectToAsset(clip,c);upper.motion=clip;layer.stateMachine.defaultState=upper;c.layers=layers;},1);
            foreach(bool defaults in new[]{false,true})Measure(output,"defaults-"+defaults,(c,s,commands)=>{var clip=Clip("B",2);AssetDatabase.AddObjectToAsset(clip,c);s[1].motion=clip;s[1].writeDefaultValues=defaults;Edge(s[0],s[1]);commands.Add(Cmd(5,"go",1));});
            foreach(int interruption in new[]{0,1,2,3,4})foreach(bool ordered in new[]{false,true})Measure(output,"interrupt-release-"+interruption+"-"+ordered,(c,s,commands)=>{var t=Edge(s[0],s[1],duration:.5f);t.interruptionSource=(TransitionInterruptionSource)interruption;t.orderedInterruption=ordered;Edge(s[0],s[2],"other",duration:.1f);Edge(s[1],s[3],"other",duration:.2f);commands.Add(Cmd(5,"go",1));commands.Add(Cmd(6,"go",0));commands.Add(Cmd(12,"other",1));});
            foreach(bool additive in new[]{false,true})foreach(float weight in new[]{.25f,.5f,1f})Measure(output,"rotation3d-"+additive+"-"+weight,(c,s,commands)=>{c.AddLayer("Upper");var layers=c.layers;layers[1].defaultWeight=weight;layers[1].blendingMode=additive?AnimatorLayerBlendingMode.Additive:AnimatorLayerBlendingMode.Override;var upper=layers[1].stateMachine.AddState("B");var clip=Clip("B",4);AssetDatabase.AddObjectToAsset(clip,c);upper.motion=clip;layers[1].stateMachine.defaultState=upper;c.layers=layers;},4);
            foreach(int kind in new[]{0,1,2,3,4,5})Measure(output,"empty-"+kind,(c,s,commands)=>{if(kind==0)c.layers=new AnimatorControllerLayer[0];if(kind==1){var m=c.layers[0].stateMachine;foreach(var state in m.states)m.RemoveState(state.state);}if(kind==2)s[0].motion=null;if(kind==3){s[1].motion=null;Edge(s[0],s[1]);commands.Add(Cmd(5,"go",1));}if(kind==4){var clip=(AnimationClip)s[0].motion;clip.ClearCurves();clip.SetCurve("target",typeof(GameObject),"m_IsActive",AnimationCurve.Constant(0,0,1));commands.Add(Cmd(5,"",0,7));}if(kind==5){var t=c.layers[0].stateMachine.AddEntryTransition(s[1]);t.AddCondition(AnimatorConditionMode.If,0,"go");var e=s[0].AddExitTransition();e.hasExitTime=false;e.duration=0;e.AddCondition(AnimatorConditionMode.If,0,"go");commands.Add(Cmd(5,"go",1));}});
            foreach(int kind in new[]{0,1,2,3,4,5})Measure(output,"events-"+kind,(c,s,commands)=>{
                foreach(var state in s){var clip=(AnimationClip)state.motion;var ev=new List<AnimationEvent>();foreach(float time in new[]{0f,.1f,.25f,.5f,1f})ev.Add(new AnimationEvent{time=time,functionName="ReceiveControllerEvent",stringParameter=state.name+"@"+time,messageOptions=SendMessageOptions.RequireReceiver});if(kind==3)ev.Insert(3,new AnimationEvent{time=.25f,functionName="ReceiveControllerEvent",stringParameter=state.name+"@duplicate",messageOptions=SendMessageOptions.RequireReceiver});AnimationUtility.SetAnimationEvents(clip,ev.ToArray());}
                if(kind<3){Edge(s[0],s[1],duration:kind==0?0:kind==1?.1f:.5f);commands.Add(Cmd(5,"go",1));}
                if(kind==3)s[0].speed=-1;
                if(kind==4){s[0].timeParameter="f";s[0].timeParameterActive=true;commands.Add(Cmd(5,"f",.5f,0));commands.Add(Cmd(10,"f",.2f,0));commands.Add(Cmd(15,"f",1.2f,0));}
                if(kind==5){s[0].cycleOffset=.3f;commands.Add(Cmd(12,"Base Layer.B",0,6));}
            });
            foreach(bool loop in new[]{false,true})foreach(int when in new[]{5,15,25,75})Measure(output,"exit-condition-"+loop+"-"+when,(c,s,commands)=>{var t=Edge(s[0],s[1]);t.hasExitTime=true;t.exitTime=.25f;commands.Add(Cmd(when,"go",1));},0,loop);
            foreach(float speed in new[]{.5f,2f})foreach(bool fixedDuration in new[]{false,true})Measure(output,"speed-blend-"+speed+"-"+fixedDuration,(c,s,commands)=>{s[0].speed=speed;var t=Edge(s[0],s[1],duration:.2f);t.hasFixedDuration=fixedDuration;commands.Add(Cmd(5,"go",1));});
            foreach(bool allLayers in new[]{false,true})Measure(output,"trigger-layers-"+allLayers,(c,s,commands)=>{Edge(s[0],s[1],"trigger");c.AddLayer("Upper");var layers=c.layers;layers[1].defaultWeight=1;var m=layers[1].stateMachine;var a=m.AddState("A");a.motion=s[0].motion;var b=m.AddState("B");b.motion=s[1].motion;m.defaultState=a;if(allLayers)Edge(a,b,"trigger");c.layers=layers;commands.Add(Cmd(5,"trigger",1,3));});
            foreach(bool additive in new[]{false,true})foreach(float weight in new[]{.25f,.5f,1f})Measure(output,"layer-transition-"+additive+"-"+weight,(c,s,commands)=>{c.AddLayer("Upper");var layers=c.layers;layers[1].defaultWeight=weight;layers[1].blendingMode=additive?AnimatorLayerBlendingMode.Additive:AnimatorLayerBlendingMode.Override;var m=layers[1].stateMachine;var a=m.AddState("A");a.motion=s[0].motion;a.writeDefaultValues=true;var b=m.AddState("B");b.motion=s[1].motion;b.writeDefaultValues=true;m.defaultState=a;Edge(a,b,duration:.37f);c.layers=layers;commands.Add(Cmd(5,"go",1));},4);
            foreach(float duration in new[]{.1f,.37f})Measure(output,"exit-blend-"+duration,(c,s,commands)=>{var t=s[0].AddTransition(s[1]);t.hasExitTime=true;t.exitTime=.75f;t.hasFixedDuration=true;t.duration=duration;});
            foreach(float weight in new[]{.25f,.5f,.75f,1f})foreach(bool baseValue in new[]{false,true})foreach(bool upperValue in new[]{false,true})Measure(output,"additive-bool-"+weight+"-"+baseValue+"-"+upperValue,(c,s,commands)=>{
                var a=(AnimationClip)s[0].motion;a.ClearCurves();a.SetCurve("target",typeof(GameObject),"m_IsActive",AnimationCurve.Constant(0,1,baseValue?1:0));
                c.AddLayer("Upper");var layers=c.layers;layers[1].defaultWeight=weight;layers[1].blendingMode=AnimatorLayerBlendingMode.Additive;var m=layers[1].stateMachine;var b=m.AddState("B");b.writeDefaultValues=true;var clip=new AnimationClip();var curve=new AnimationCurve(new Keyframe(0,upperValue?1:0),new Keyframe(.4f,upperValue?0:1),new Keyframe(1,upperValue?0:1));for(int i=0;i<curve.length;i++){var k=curve[i];k.inTangent=k.outTangent=float.PositiveInfinity;curve.MoveKey(i,k);}clip.SetCurve("target",typeof(GameObject),"m_IsActive",curve);AssetDatabase.AddObjectToAsset(clip,c);b.motion=clip;m.defaultState=b;c.layers=layers;
            });
            foreach(bool defaults in new[]{false,true})Measure(output,"defaults-separate-"+defaults,(c,s,commands)=>{var clip=(AnimationClip)s[1].motion;clip.ClearCurves();clip.SetCurve("target",typeof(Transform),"localScale.x",AnimationCurve.Linear(0,2,1,4));s[1].writeDefaultValues=defaults;Edge(s[0],s[1]);commands.Add(Cmd(5,"go",1));});
            foreach(bool additive in new[]{false,true})foreach(float weight in new[]{.25f,.5f,1f})Measure(output,"layer-properties-"+additive+"-"+weight,(c,s,commands)=>{c.AddLayer("Upper");var layers=c.layers;layers[1].defaultWeight=weight;layers[1].blendingMode=additive?AnimatorLayerBlendingMode.Additive:AnimatorLayerBlendingMode.Override;var m=layers[1].stateMachine;var b=m.AddState("B");b.motion=s[1].motion;b.writeDefaultValues=true;m.defaultState=b;c.layers=layers;},5);
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));AssetDatabase.SaveAssets();
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
    }
}

public class NatsumeControllerEventReceiver : MonoBehaviour {
    public void ReceiveControllerEvent(AnimationEvent e) { NatsumeAnimatorControllerProbe.Receive(e.stringParameter); }
}
