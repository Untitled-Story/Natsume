using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

public static class NatsumeAnimationProbe
{
    [Serializable] public class Key { public float time, value, inSlope, outSlope, inWeight, outWeight; public int weightedMode; }
    [Serializable] public class Sample { public float time, value; }
    [Serializable] public class CurveCase { public string label; public int interpolation, preWrap, postWrap; public bool holdout; public Key[] keys; public Sample[] samples; }
    [Serializable] public class ClockSample { public float elapsed, value, normalizedTime; public bool active, ownerActive; }
    [Serializable] public class ClockCase { public string label; public float duration, speed, offset, storedOffset, delta; public bool loop, holdout; public ClockSample[] samples; }
    [Serializable] public class Output { public string unityVersion, measuredAt; public CurveCase[] curves; public ClockCase[] clocks, disableClocks; }
    static Key Describe(Keyframe k) { return new Key { time=k.time,value=k.value,inSlope=float.IsInfinity(k.inTangent)?0:k.inTangent,outSlope=float.IsInfinity(k.outTangent)?0:k.outTangent,inWeight=k.inWeight,outWeight=k.outWeight,weightedMode=(int)k.weightedMode }; }
    static CurveCase Curve(int mode,float duration,int pre,int post,int shape,bool holdout)
    {
        float[] times={.13f*duration,.37f*duration,.81f*duration,duration};
        var keys=times.Select((t,i)=>new Keyframe(t,(i%2==0?1:-1)*(shape+1)*.7f,(i-1)*1.3f/duration,(2-i)*.9f/duration,.1f+shape*.15f,.8f-shape*.19f)).ToArray();
        for(int i=0;i<keys.Length;i++) {
            var k=keys[i];
            if(mode==0) k.inTangent=k.outTangent=float.PositiveInfinity;
            if(mode==1) { k.inTangent=i==0?0:(k.value-keys[i-1].value)/(k.time-keys[i-1].time); k.outTangent=i==keys.Length-1?0:(keys[i+1].value-k.value)/(keys[i+1].time-k.time); }
            if(mode==3) k.weightedMode=(WeightedMode)(shape%3+1);
            keys[i]=k;
        }
        var c=new AnimationCurve(keys); c.preWrapMode=(WrapMode)pre;c.postWrapMode=(WrapMode)post;
        var inputs=Enumerable.Range(0,65).Select(i=>(i/32f-0.5f)*duration).Concat(times.SelectMany(t=>new[]{t-1e-6f*duration,t,t+1e-6f*duration})).ToArray();
        return new CurveCase{label=$"curve-{mode}-{duration}-{pre}-{post}-{shape}",interpolation=mode,preWrap=pre,postWrap=post,holdout=holdout,keys=keys.Select(Describe).ToArray(),samples=inputs.Select(t=>new Sample{time=t,value=c.Evaluate(t)}).ToArray()};
    }
    static ClockCase Clock(float duration,bool loop,float speed,float offset,float delta,bool holdout,int index,bool disable=false,bool keep=false)
    {
        var clip=new AnimationClip{name="Clock"};
        clip.SetCurve("target",typeof(Transform),"localPosition.x",duration==0?new AnimationCurve(new Keyframe(0,2)):AnimationCurve.Linear(0,2,duration,6));
        var active=duration==0?new AnimationCurve(new Keyframe(0,1)):new AnimationCurve(new Keyframe(0,1),new Keyframe(duration*.25f,0),new Keyframe(duration*.75f,1),new Keyframe(duration,1));
        for(int i=0;i<active.length;i++){var k=active[i];k.inTangent=k.outTangent=float.PositiveInfinity;active.MoveKey(i,k);}
        clip.SetCurve("target",typeof(GameObject),"m_IsActive",active);
        var settings=AnimationUtility.GetAnimationClipSettings(clip);settings.loopTime=loop;AnimationUtility.SetAnimationClipSettings(clip,settings);
        string path=$"Assets/AnimationClockProbe{index}.controller";
        var controller=AnimatorController.CreateAnimatorControllerAtPath(path);AssetDatabase.AddObjectToAsset(clip,controller);
        var state=controller.layers[0].stateMachine.AddState("Probe");state.motion=clip;state.speed=speed;state.cycleOffset=offset;var serialized=new SerializedObject(state);serialized.FindProperty("m_CycleOffset").floatValue=offset;serialized.ApplyModifiedPropertiesWithoutUndo();state.writeDefaultValues=true;controller.layers[0].stateMachine.defaultState=state;
        var go=new GameObject("clock");var target=new GameObject("target");target.transform.SetParent(go.transform);var animator=go.AddComponent<Animator>();animator.keepAnimatorStateOnDisable=keep;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;animator.runtimeAnimatorController=controller;
        animator.Rebind();animator.Play("Base Layer.Probe",0,0);animator.Update(0);
        var samples=new List<ClockSample>();float elapsed=0;
        for(int i=0;i<=96;i++){if(disable && i==4)go.SetActive(false);if(disable && i==8){go.SetActive(true);animator.Update(0);}samples.Add(new ClockSample{elapsed=elapsed,value=target.transform.localPosition.x,active=target.activeSelf,ownerActive=go.activeSelf,normalizedTime=animator.GetCurrentAnimatorStateInfo(0).normalizedTime});if(go.activeSelf)animator.Update(delta);elapsed+=delta;}
        float stored=state.cycleOffset;UnityEngine.Object.DestroyImmediate(go);AssetDatabase.DeleteAsset(path);
        return new ClockCase{label=$"clock-{index}",duration=duration,speed=speed,offset=offset,storedOffset=stored,delta=delta,loop=loop,holdout=holdout,samples=samples.ToArray()};
    }
    public static void Run()
    {
        try {
            var curves=new List<CurveCase>();var clocks=new List<ClockCase>();var disableClocks=new List<ClockCase>();
            foreach(int mode in new[]{0,1,2,3})foreach(float duration in new[]{.3f,1.7f,4.1f})foreach(int pre in new[]{1,2,4})foreach(int post in new[]{1,2,4})foreach(int shape in new[]{0,1,2,3})curves.Add(Curve(mode,duration,pre,post,shape,false));
            foreach(int mode in new[]{0,1,2,3})foreach(float duration in new[]{.73f,2.31f})foreach(int wrap in new[]{1,2,4})foreach(int shape in new[]{0,2})curves.Add(Curve(mode,duration,wrap,wrap,shape,true));
            int index=0;
            foreach(float duration in new[]{0f,.5f,1.3f})foreach(bool loop in new[]{false,true})foreach(float speed in new[]{0f,.5f,1f,2f})foreach(float offset in new[]{-.25f,0f,.25f,1f,1.25f})clocks.Add(Clock(duration,loop,speed,offset,1f/60,false,index++));
            foreach(float duration in new[]{.73f,1.71f})foreach(bool loop in new[]{false,true})foreach(float speed in new[]{.3f,1.7f})foreach(float offset in new[]{0f,.37f,1.13f})clocks.Add(Clock(duration,loop,speed,offset,1f/37,true,index++));
            foreach(bool keep in new[]{false,true})disableClocks.Add(Clock(1,true,1,.25f,1f/60,false,index++,true,keep));
            var output=new Output{unityVersion=Application.unityVersion,measuredAt=DateTime.UtcNow.ToString("o"),curves=curves.ToArray(),clocks=clocks.ToArray(),disableClocks=disableClocks.ToArray()};
            string path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
        }catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
