using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using UnityEngine.UI;

/** Checks source-binding identities without importing placeholder game scripts. */
public static class NatsumeSourceBindingProbe
{
    [Serializable] public class BoolCase { public float value; public bool active; }
    [Serializable] public class HashCase { public string text; public uint hash; }
    [Serializable] public class DuplicateCase { public bool swapSiblingOrder, firstActive, secondActive, animatorFirstActive, animatorSecondActive; }
    [Serializable] public class Output
    {
        public string unityVersion, timestamp;
        public List<BoolCase> active = new List<BoolCase>();
        public List<HashCase> hashes = new List<HashCase>();
        public List<DuplicateCase> duplicates = new List<DuplicateCase>();
        public string[] imageColorBindings, particleHashMatches;
        public float imageAlpha, burstCount;
        public float inactiveCustomColorR, activeCustomVector;
        public int customModeAfterColorAnimation;
        public bool missingTargetIgnored;
    }
    public static void Run()
    {
        try {
            var result = new Output { unityVersion=Application.unityVersion, timestamp=DateTime.UtcNow.ToString("o") };
            foreach(string name in new[] {"", "root/rain_back", "root/雨/泡泡", "m_IsActive", "m_Color.a", "m_Color.r", "m_Color.g", "m_Color.b", "mode", "EmissionModule.m_Bursts.Array.data[0].countCurve.scalar"})
                result.hashes.Add(new HashCase {text=name,hash=unchecked((uint)Animator.StringToHash(name))});
            foreach(float value in new[] {-1f,-.1f,0f,.01f,.49f,.5f,.51f,1.2f}) {
                var root=new GameObject("root");var target=new GameObject("target");target.transform.SetParent(root.transform);
                var clip=new AnimationClip();
                clip.SetCurve("target",typeof(GameObject),"m_IsActive",AnimationCurve.Constant(0,1,value));
                clip.SampleAnimation(root,0);
                result.active.Add(new BoolCase {value=value,active=target.activeSelf});
                UnityEngine.Object.DestroyImmediate(clip);UnityEngine.Object.DestroyImmediate(root);
            }
            {
                var root=new GameObject("root");var target=new GameObject("target");target.transform.SetParent(root.transform);
                var ps=target.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                var custom=ps.customData;custom.enabled=true;custom.SetMode(ParticleSystemCustomData.Custom1,ParticleSystemCustomDataMode.Vector);custom.SetVectorComponentCount(ParticleSystemCustomData.Custom1,1);custom.SetVector(ParticleSystemCustomData.Custom1,0,new ParticleSystem.MinMaxCurve(2));
                var clip=new AnimationClip();clip.SetCurve("target",typeof(ParticleSystem),"CustomDataModule.color0.maxColor.r",AnimationCurve.Constant(0,1,.73f));clip.SampleAnimation(root,.5f);
                result.customModeAfterColorAnimation=(int)ps.customData.GetMode(ParticleSystemCustomData.Custom1);
                result.inactiveCustomColorR=new SerializedObject(ps).FindProperty("CustomDataModule.color0.maxColor").colorValue.r;
                result.activeCustomVector=ps.customData.GetVector(ParticleSystemCustomData.Custom1,0).constantMax;
                UnityEngine.Object.DestroyImmediate(clip);UnityEngine.Object.DestroyImmediate(root);
            }
            foreach(bool swap in new[]{false,true}) {
                var root=new GameObject("duplicate");var first=new GameObject("target");first.transform.SetParent(root.transform);var second=new GameObject("target");second.transform.SetParent(root.transform);
                if(swap)second.transform.SetSiblingIndex(0);
                var clip=new AnimationClip();clip.SetCurve("target",typeof(GameObject),"m_IsActive",AnimationCurve.Constant(0,1,0));clip.SampleAnimation(root,.5f);
                var row=new DuplicateCase {swapSiblingOrder=swap,firstActive=first.activeSelf,secondActive=second.activeSelf};
                first.SetActive(true);second.SetActive(true);
                string path="Assets/SourceBindingDuplicate"+swap+".controller";
                var controller=AnimatorController.CreateAnimatorControllerAtPath(path);AssetDatabase.AddObjectToAsset(clip,controller);
                var state=controller.layers[0].stateMachine.AddState("Default");state.motion=clip;controller.layers[0].stateMachine.defaultState=state;
                var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=controller;animator.Play("Base Layer.Default",0,0);animator.Update(0);
                row.animatorFirstActive=first.activeSelf;row.animatorSecondActive=second.activeSelf;result.duplicates.Add(row);
                UnityEngine.Object.DestroyImmediate(root);AssetDatabase.DeleteAsset(path);
            }
            {
                var root=new GameObject("root");var target=new GameObject("target");target.transform.SetParent(root.transform);
                var clip=new AnimationClip();clip.SetCurve("absent",typeof(GameObject),"m_IsActive",AnimationCurve.Constant(0,1,0));clip.SampleAnimation(root,.5f);
                result.missingTargetIgnored=root.activeSelf&&target.activeSelf;
                UnityEngine.Object.DestroyImmediate(clip);UnityEngine.Object.DestroyImmediate(root);
            }
            {
                var root=new GameObject("root");var target=new GameObject("target",typeof(RectTransform),typeof(CanvasRenderer),typeof(Image));target.transform.SetParent(root.transform);
                var image=target.GetComponent<Image>();
                result.imageColorBindings=AnimationUtility.GetAnimatableBindings(target,root).Where(b=>b.type==typeof(Image)&&b.propertyName.StartsWith("m_Color.")).Select(b=>b.propertyName).ToArray();
                var clip=new AnimationClip();clip.SetCurve("target",typeof(Image),"m_Color.a",AnimationCurve.Constant(0,1,.37f));clip.SampleAnimation(root,.5f);result.imageAlpha=image.color.a;
                UnityEngine.Object.DestroyImmediate(clip);UnityEngine.Object.DestroyImmediate(root);
            }
            {
                var root=new GameObject("root");var target=new GameObject("target");target.transform.SetParent(root.transform);
                var ps=target.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                var emission=ps.emission;emission.SetBursts(new[]{new ParticleSystem.Burst(0,1)});
                result.particleHashMatches=AnimationUtility.GetAnimatableBindings(target,root).Where(b=>b.type==typeof(ParticleSystem)&&unchecked((uint)Animator.StringToHash(b.propertyName))==0x45ECBD03).Select(b=>b.propertyName).ToArray();
                var clip=new AnimationClip();clip.SetCurve("target",typeof(ParticleSystem),"EmissionModule.m_Bursts.Array.data[0].countCurve.scalar",AnimationCurve.Constant(0,1,7));clip.SampleAnimation(root,.5f);result.burstCount=ps.emission.GetBurst(0).count.constantMax;
                UnityEngine.Object.DestroyImmediate(clip);UnityEngine.Object.DestroyImmediate(root);
            }
            var output=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(output));File.WriteAllText(output,JsonUtility.ToJson(result,true));
        } catch(Exception error) {Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
