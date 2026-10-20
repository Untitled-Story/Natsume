using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

public static class NatsumeBindingProbe
{
    [Serializable] public class Channel { public string name; public float first, last; }
    [Serializable] public class Sample {
        public float time; public Vector3 position, scale, anchored; public Quaternion rotation;
        public float[] world, values; public bool active, enabled;
        public Vector2 size, anchorMin, anchorMax, pivot;
    }
    [Serializable] public class Case {
        public string label, kind, property; public int variant; public bool holdout;
        public Channel[] channels; public Sample[] samples;
    }
    [Serializable] public class StateCase { public bool writeDefaults; public float[] first, second; }
    [Serializable] public class Output { public string unityVersion, measuredAt; public Case[] cases; public StateCase[] states; public DisableCase[] disables; public string[] particleBindings; public bool particleHasEnabled; public ConflictCase[] conflicts; }
    [Serializable] public class ConflictCase { public bool childCreatedFirst; public float value, reenabledValue; }
    [Serializable] public class DisableCase { public bool keepState, writeDefaults, nodeInactive; public float before, disabled, resumed, beforeTime, disabledTime, resumedTime; }
    static Output pending;
    static readonly List<GameObject> conflictRoots = new List<GameObject>();
    static readonly List<ConflictCase> conflictResults = new List<ConflictCase>();
    static int startFrame = -1, disablePhase;
    static readonly List<GameObject> disableRoots=new List<GameObject>();
    static readonly List<Animator> disableAnimators=new List<Animator>();
    static readonly List<DisableCase> disableResults=new List<DisableCase>();
    static bool oldOptionsEnabled;
    static EnterPlayModeOptions oldOptions;
    static AnimatorController Controller(string path, string target, float value) {
        var controller=AnimatorController.CreateAnimatorControllerAtPath(path);
        var clip=new AnimationClip();clip.SetCurve(target,typeof(Transform),"m_LocalPosition.x",AnimationCurve.Constant(0,1,value));AssetDatabase.AddObjectToAsset(clip,controller);
        var state=controller.layers[0].stateMachine.AddState("Default");state.motion=clip;controller.layers[0].stateMachine.defaultState=state;return controller;
    }
    static void Tick() {
        try { TickFrame(); }
        catch(Exception error) { Debug.LogException(error); Finish(1); }
    }
    static void Finish(int code) {
        EditorApplication.update-=Tick;
        EditorSettings.enterPlayModeOptionsEnabled=oldOptionsEnabled;
        EditorSettings.enterPlayModeOptions=oldOptions;
        EditorApplication.Exit(code);
    }
    static void TickFrame() {
        if(!EditorApplication.isPlaying || EditorApplication.isPaused)return;
        if(startFrame<0) {
            foreach(bool childFirst in new[]{false,true}) {
                var root=new GameObject("conflict");var child=new GameObject("child");child.transform.SetParent(root.transform,false);var target=new GameObject("target");target.transform.SetParent(child.transform,false);
                var parentController=Controller("Assets/BindingParent"+childFirst+".controller","child/target",9);
                var childController=Controller("Assets/BindingChild"+childFirst+".controller","target",8);
                if(childFirst){child.AddComponent<Animator>().runtimeAnimatorController=childController;root.AddComponent<Animator>().runtimeAnimatorController=parentController;}
                else{root.AddComponent<Animator>().runtimeAnimatorController=parentController;child.AddComponent<Animator>().runtimeAnimatorController=childController;}
                conflictRoots.Add(root);conflictResults.Add(new ConflictCase{childCreatedFirst=childFirst});
            }
            int serial=0;
            foreach(bool keep in new[]{false,true})foreach(bool defaults in new[]{false,true})foreach(bool inactive in new[]{false,true}) {
                var controller=Controller("Assets/BindingDisable"+(serial++)+".controller","target",9);
                var root=new GameObject("disable");var child=new GameObject("target");child.transform.SetParent(root.transform,false);child.transform.localPosition=new Vector3(3,4,5);
                var animator=root.AddComponent<Animator>();animator.keepAnimatorStateOnDisable=keep;animator.writeDefaultValuesOnDisable=defaults;animator.runtimeAnimatorController=controller;
                disableRoots.Add(root);disableAnimators.Add(animator);disableResults.Add(new DisableCase{keepState=keep,writeDefaults=defaults,nodeInactive=inactive});
            }
            startFrame=Time.frameCount;return;
        }
        if(Time.frameCount-startFrame<12)return;
        if(startFrame>=0) {
            for(int i=0;i<conflictRoots.Count;i++) {
                if(conflictResults[i].value==0) {
                    conflictResults[i].value=conflictRoots[i].transform.GetChild(0).GetChild(0).localPosition.x;
                    var first=conflictResults[i].childCreatedFirst?conflictRoots[i].transform.GetChild(0).GetComponent<Animator>():conflictRoots[i].GetComponent<Animator>();
                    first.enabled=false;first.enabled=true;
                } else conflictResults[i].reenabledValue=conflictRoots[i].transform.GetChild(0).GetChild(0).localPosition.x;
            }

        }
        for(int i=0;i<disableRoots.Count;i++) {
            var result=disableResults[i];var root=disableRoots[i];var animator=disableAnimators[i];float value=root.transform.GetChild(0).localPosition.x;
            if(disablePhase==0){result.before=value;result.beforeTime=animator.GetCurrentAnimatorStateInfo(0).normalizedTime;if(result.nodeInactive)root.SetActive(false);else animator.enabled=false;}
            else if(disablePhase==1){result.disabled=value;result.disabledTime=animator.GetCurrentAnimatorStateInfo(0).normalizedTime;if(result.nodeInactive)root.SetActive(true);else animator.enabled=true;}
            else {result.resumed=value;result.resumedTime=animator.GetCurrentAnimatorStateInfo(0).normalizedTime;}
        }
        if(disablePhase++<2){startFrame=Time.frameCount;return;}
        pending.disables=disableResults.ToArray();pending.conflicts=conflictResults.ToArray();Save(pending);
        Finish(0);
    }
    static void Save(Output output) {
        string dest=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(dest));File.WriteAllText(dest,JsonUtility.ToJson(output,true));
    }
    static ParticleSystem Particle(GameObject go) {
        var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
        var main=ps.main; main.playOnAwake=false;main.startLifetime=new ParticleSystem.MinMaxCurve(2,5); main.startSpeed=3;main.startSize3D=true;main.startSizeX=2;main.startSizeY=3;main.startSizeZ=4;main.startRotation3D=true;main.startRotationX=.1f;main.startRotationY=.2f;main.startRotationZ=.3f;main.gravityModifier=0;
        main.startColor=new ParticleSystem.MinMaxGradient(new Color(.2f,.3f,.4f,.5f),new Color(.6f,.7f,.8f,.9f));
        var emission=ps.emission;emission.enabled=true;emission.rateOverTime=7;emission.rateOverDistance=2;
        var velocity=ps.velocityOverLifetime;velocity.enabled=true;velocity.x=1;velocity.y=2;velocity.z=3;
        var custom=ps.customData;custom.enabled=true;custom.SetMode(ParticleSystemCustomData.Custom1,ParticleSystemCustomDataMode.Color);custom.SetMode(ParticleSystemCustomData.Custom2,ParticleSystemCustomDataMode.Color);custom.SetColor(ParticleSystemCustomData.Custom1,new ParticleSystem.MinMaxGradient(new Color(.1f,.2f,.3f,.4f),new Color(.5f,.6f,.7f,.8f)));custom.SetColor(ParticleSystemCustomData.Custom2,new ParticleSystem.MinMaxGradient(new Color(.1f,.2f,.3f,.4f),new Color(.5f,.6f,.7f,.8f)));
        return ps;
    }
    static Sample Read(GameObject target, float time, string kind, string property, Material material, ParticleSystem ps) {
        var tr=target.transform;var rt=tr as RectTransform;
        var s=new Sample{time=time,position=tr.localPosition,rotation=tr.localRotation,scale=tr.localScale,world=Enumerable.Range(0,16).Select(i=>tr.localToWorldMatrix[i]).ToArray(),active=target.activeSelf,enabled=target.GetComponent<Renderer>() ? target.GetComponent<Renderer>().enabled : true};
        if(rt){s.anchored=rt.anchoredPosition3D;s.size=rt.sizeDelta;s.anchorMin=rt.anchorMin;s.anchorMax=rt.anchorMax;s.pivot=rt.pivot;}
        if(kind=="material") {
            var block=new MaterialPropertyBlock();target.GetComponent<Renderer>().GetPropertyBlock(block);
            if(property=="_TintColor"&&block.HasColor(property)){var c=block.GetColor(property);s.values=new[]{c.r,c.g,c.b,c.a};return s;}
            if(property=="_MainTex_ST"&&block.HasVector(property)){var v=block.GetVector(property);s.values=new[]{v.x,v.y,v.z,v.w};return s;}
            if(property=="_InvFade"&&block.HasFloat(property)){s.values=new[]{block.GetFloat(property)};return s;}
            if(property=="_TintColor") {var c=material.GetColor(property);s.values=new[]{c.r,c.g,c.b,c.a};}
            else if(property=="_MainTex_ST"){var scale=material.GetTextureScale("_MainTex");var offset=material.GetTextureOffset("_MainTex");s.values=new[]{scale.x,scale.y,offset.x,offset.y};}
            else s.values=new[]{material.GetFloat(property)};
        }
        if(kind=="particle") {
            var so=new SerializedObject(ps);so.Update();
            var p=so.FindProperty(property);s.values=new[]{p==null?-999f:p.propertyType==SerializedPropertyType.Boolean?(p.boolValue?1f:0f):p.floatValue};
        }
        return s;
    }
    static Case RunCase(string kind,string property,int variant,int serial) {
        var root=new GameObject("binding");
        GameObject target;
        if(kind=="layout") {
            var parent=new GameObject("parent",typeof(RectTransform));parent.transform.SetParent(root.transform,false);var pr=(RectTransform)parent.transform;pr.sizeDelta=new Vector2(200,100);pr.pivot=new Vector2(.3f,.7f);
            target=new GameObject("target",typeof(RectTransform));target.transform.SetParent(pr,false);var rt=(RectTransform)target.transform;rt.anchorMin=new Vector2(.1f,.2f);rt.anchorMax=new Vector2(.8f,.9f);rt.pivot=new Vector2(.25f,.75f);rt.sizeDelta=new Vector2(20,-10);rt.anchoredPosition3D=new Vector3(3,4,5);
        } else {
            var parent=new GameObject("parent");parent.transform.SetParent(root.transform,false);parent.transform.localPosition=new Vector3(2,-3,4);parent.transform.localRotation=Quaternion.Euler(10,20,30);parent.transform.localScale=new Vector3(2,3,.5f);
            target=new GameObject("target");target.transform.SetParent(parent.transform,false);target.transform.localPosition=new Vector3(3,4,5);target.transform.localRotation=Quaternion.Euler(20,35,55);target.transform.localScale=new Vector3(1.2f,.8f,2);
        }
        ParticleSystem ps=null;Material material=null;
        if(kind=="particle"||kind=="material"||kind=="renderer") {
            ps=Particle(target);material=new Material(Shader.Find("Legacy Shaders/Particles/Alpha Blended"));material.SetColor("_TintColor",new Color(.2f,.4f,.6f,.8f));material.SetTextureScale("_MainTex",new Vector2(2,3));material.SetTextureOffset("_MainTex",new Vector2(.1f,.2f));material.SetFloat("_InvFade",2);ps.GetComponent<ParticleSystemRenderer>().sharedMaterial=material;
        }
        var clip=new AnimationClip();var channels=new List<Channel>();
        string path="parent/target";Type type=kind=="layout"?typeof(RectTransform):kind=="particle"?typeof(ParticleSystem):kind=="material"||kind=="renderer"?typeof(ParticleSystemRenderer):kind=="active"?typeof(GameObject):typeof(Transform);
        string[] components=property=="m_IsActive"||property=="m_Enabled"||kind=="particle"||property=="_InvFade"?new[]{""}:property=="_TintColor"?new[]{"r","g","b","a"}:property=="m_LocalRotation"||property=="_MainTex_ST"?new[]{"x","y","z","w"}:property=="m_SizeDelta"||property=="m_AnchorMin"||property=="m_AnchorMax"||property=="m_Pivot"?new[]{"x","y"}:new[]{"x","y","z"};
        for(int axis=0;axis<components.Length;axis++) {
            if(components.Length>1 && variant%3==1 && axis!=0)continue;
            string name=property+(components[axis]==""?"":"."+components[axis]);if(kind=="material")name="material."+name;
            float first=kind=="active"||kind=="renderer"?1:property=="m_AnchorMin"||property=="m_AnchorMax"||property=="m_Pivot"?.1f:property=="localEulerAnglesRaw"?(variant%2==0?350:-80):.2f+axis*.3f;
            if(property=="localEulerAnglesRaw")first+=variant*7.13f;
            else if(kind!="active"&&kind!="renderer"&&property!="looping")first+=variant*(kind=="layout"?.00017f:.017f);
            float last=kind=="active"||kind=="renderer"?0:property=="m_AnchorMin"||property=="m_AnchorMax"||property=="m_Pivot"?.8f:property=="localEulerAnglesRaw"?(variant%2==0?450:100):1.7f-axis*.4f;
            if(property=="localEulerAnglesRaw")last+=variant*11.37f;
            else if(kind!="active"&&kind!="renderer"&&property!="looping")last+=variant*(kind=="layout"?.00023f:.023f);
            if(kind=="particle"&&property=="looping"){first=1;last=0;}
            var c=AnimationCurve.Linear(0,first,1,last);
            if(kind=="active"||kind=="renderer"||property=="looping") {var a=c.keys;a[0].outTangent=float.PositiveInfinity;a[1].inTangent=float.PositiveInfinity;c.keys=a;}
            clip.SetCurve(path,type,name,c);channels.Add(new Channel{name=components[axis],first=first,last=last});
        }
        var samples=new List<Sample>();
        foreach(float time in new[]{0f,.13f,.25f,.5f,.75f,.99f,1f}) {clip.SampleAnimation(root,time);samples.Add(Read(target,time,kind,property,material,ps));}
        var result=new Case{label="binding-"+serial,kind=kind,property=property,variant=variant,holdout=variant>=(kind=="transform"?96:kind=="layout"?64:kind=="material"?48:12),channels=channels.ToArray(),samples=samples.ToArray()};
        UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(clip);if(material)UnityEngine.Object.DestroyImmediate(material);return result;
    }
    static StateCase Defaults(bool writeDefaults,int index) {
        string path="Assets/BindingDefaults"+index+".controller";var c=AnimatorController.CreateAnimatorControllerAtPath(path);var machine=c.layers[0].stateMachine;
        var a=new AnimationClip();a.SetCurve("target",typeof(Transform),"m_LocalPosition.x",AnimationCurve.Constant(0,1,9));AssetDatabase.AddObjectToAsset(a,c);
        var b=new AnimationClip();b.SetCurve("target",typeof(Transform),"m_LocalScale.x",AnimationCurve.Constant(0,1,8));AssetDatabase.AddObjectToAsset(b,c);
        var sa=machine.AddState("A");sa.motion=a;sa.writeDefaultValues=true;var sb=machine.AddState("B");sb.motion=b;sb.writeDefaultValues=writeDefaults;machine.defaultState=sa;
        var root=new GameObject("states");var target=new GameObject("target");target.transform.SetParent(root.transform);target.transform.localPosition=new Vector3(3,4,5);var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=c;animator.Play("Base Layer.A",0,0);animator.Update(0);var first=target.transform.localPosition;animator.Play("Base Layer.B",0,0);animator.Update(0);var second=target.transform.localPosition;
        UnityEngine.Object.DestroyImmediate(root);AssetDatabase.DeleteAsset(path);return new StateCase{writeDefaults=writeDefaults,first=new[]{first.x,first.y,first.z},second=new[]{second.x,second.y,second.z}};
    }
    public static void Run() {
        try {
            var cases=new List<Case>();int serial=0;
            foreach(string property in new[]{"m_LocalPosition","m_LocalScale","m_LocalRotation","localEulerAnglesRaw"})foreach(int variant in Enumerable.Range(0,120))cases.Add(RunCase("transform",property,variant,serial++));
            foreach(string property in new[]{"m_AnchoredPosition","m_SizeDelta","m_AnchorMin","m_AnchorMax","m_Pivot"})foreach(int variant in Enumerable.Range(0,80))cases.Add(RunCase("layout",property,variant,serial++));
            foreach(string property in new[]{"InitialModule.startLifetime.scalar","InitialModule.startLifetime.minScalar","InitialModule.startSpeed.scalar","InitialModule.startSize.scalar","InitialModule.startSizeY.scalar","InitialModule.startSizeZ.scalar","InitialModule.startRotationX.scalar","InitialModule.startRotationY.scalar","InitialModule.startRotation.scalar","InitialModule.gravityModifier.scalar","EmissionModule.rateOverTime.scalar","EmissionModule.rateOverDistance.scalar","VelocityModule.x.scalar","VelocityModule.y.scalar","VelocityModule.z.scalar","looping","InitialModule.startColor.minColor.r","InitialModule.startColor.maxColor.a","CustomDataModule.color0.maxColor.g","CustomDataModule.color1.minColor.b","m_Enabled"})foreach(int variant in Enumerable.Range(0,15))cases.Add(RunCase("particle",property,variant,serial++));
            foreach(string property in new[]{"_TintColor","_MainTex_ST","_InvFade"})foreach(int variant in Enumerable.Range(0,60))cases.Add(RunCase("material",property,variant,serial++));
            cases.Add(RunCase("active","m_IsActive",0,serial++));cases.Add(RunCase("renderer","m_Enabled",0,serial++));
            var go=new GameObject("inspect");var ps=Particle(go);bool hasEnabled=new SerializedObject(ps).FindProperty("m_Enabled")!=null;var bindings=AnimationUtility.GetAnimatableBindings(go,go).Where(b=>b.type==typeof(ParticleSystem)).Select(b=>b.propertyName).ToArray();UnityEngine.Object.DestroyImmediate(go);
            var output=new Output{unityVersion=Application.unityVersion,measuredAt=DateTime.UtcNow.ToString("o"),cases=cases.ToArray(),states=new[]{Defaults(false,0),Defaults(true,1)},particleBindings=bindings,particleHasEnabled=hasEnabled};
            pending=output;oldOptionsEnabled=EditorSettings.enterPlayModeOptionsEnabled;oldOptions=EditorSettings.enterPlayModeOptions;
            EditorSettings.enterPlayModeOptionsEnabled=true;EditorSettings.enterPlayModeOptions=EnterPlayModeOptions.DisableDomainReload|EnterPlayModeOptions.DisableSceneReload;
            EditorApplication.update+=Tick;EditorApplication.EnterPlaymode();
        } catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
