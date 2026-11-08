using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.Animations;
using System.Text.RegularExpressions;

public static class NatsumeScriptFieldProbe
{
    [Serializable] public class Row { public string binding; public float time, key0, key1, mirror; public int mode, mirrorBits; public bool flag, discrete; }
    [Serializable] public class Output { public string unityVersion, timestamp; public List<Row> rows = new List<Row>(); }
    public static void Run()
    {
        var output = new Output { unityVersion=Application.unityVersion, timestamp=DateTime.UtcNow.ToString("o") };
        try {
            foreach (string kind in new[] { "float-numeric", "discrete-numeric", "float-bits", "discrete-bits" }) {
                var root = new GameObject("controlled"); var fields = root.AddComponent<NatsumeAnimatedFields>();
                var clip = new AnimationClip();
                var binding = kind.StartsWith("discrete") ? EditorCurveBinding.DiscreteCurve("", typeof(NatsumeAnimatedFields), "mode") : EditorCurveBinding.FloatCurve("", typeof(NatsumeAnimatedFields), "mode");
                float a = kind.EndsWith("bits") ? BitConverter.ToSingle(BitConverter.GetBytes(2), 0) : -2f;
                float b = kind.EndsWith("bits") ? BitConverter.ToSingle(BitConverter.GetBytes(5), 0) : 5f;
                var curve = AnimationCurve.Linear(0, a, 1, b);
                AnimationUtility.SetEditorCurve(clip, binding, curve);
                var stored = AnimationUtility.GetCurveBindings(clip)[0];
                foreach (float time in new[] { 0f, .25f, .5f, .75f, 1f }) {
                    fields.mode=99; clip.SampleAnimation(root, time);
                    output.rows.Add(new Row { binding=kind, time=time, key0=a, key1=b, mode=fields.mode, flag=fields.flag, discrete=stored.isDiscreteCurve });
                }
                UnityEngine.Object.DestroyImmediate(root); UnityEngine.Object.DestroyImmediate(clip);
            }
            foreach (string fieldName in new[]{"mode","discrete","choice","flag"}) foreach (bool integerMetadata in new[] {false,true}) foreach (bool bits in new[] {false,true}) {
                var root=new GameObject("controlled"); var fields=root.AddComponent<NatsumeAnimatedFields>();
                string path="Assets/ControlledField-"+fieldName+"-"+integerMetadata+"-"+bits+".anim";
                AssetDatabase.DeleteAsset(path);
                var clip=new AnimationClip();
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),fieldName),AnimationCurve.Linear(0,2,1,5));
                AssetDatabase.CreateAsset(clip,path); AssetDatabase.SaveAssets();
                string yaml=File.ReadAllText(path);
                if(integerMetadata) yaml=yaml.Replace("isIntCurve: 0","isIntCurve: 1");
                if(bits) { yaml=Regex.Replace(yaml,@"value: 2(?=\s)","value: 2.802597E-45"); yaml=Regex.Replace(yaml,@"value: 5(?=\s)","value: 7.006492E-45"); yaml=yaml.Replace("inSlope: 3","inSlope: 0").Replace("outSlope: 3","outSlope: 0"); }
                File.WriteAllText(path,yaml); AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceUpdate);
                clip=AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
                foreach(float time in new[]{0f,.25f,.5f,.75f,1f}) {
                    fields.mode=99;fields.discrete=99;fields.choice=NatsumeAnimatedFields.Choice.Unset;fields.flag=false;clip.SampleAnimation(root,time);
                    output.rows.Add(new Row{binding="yaml-"+fieldName+"-int"+integerMetadata+"-bits"+bits,time=time,mode=fieldName=="choice"?(int)fields.choice:fieldName=="discrete"?fields.discrete:fields.mode,flag=fields.flag,key0=bits?BitConverter.ToSingle(BitConverter.GetBytes(2),0):2,key1=bits?BitConverter.ToSingle(BitConverter.GetBytes(5),0):5});
                }
                UnityEngine.Object.DestroyImmediate(root);
            }
            foreach(float value in new[]{-2.500001f,-2.5f,-2.499999f,-1.5f,-.500001f,-.5f,-.499999f,-.001001f,-.0010001f,-.001f,0f,.0009999f,.001f,.0010001f,.001001f,.00101f,.0011f,.0012f,.0013f,.0014f,.499999f,.5f,.500001f,1.5f,2.5f,3.5f}) {
                var root=new GameObject("bool threshold");var fields=root.AddComponent<NatsumeAnimatedFields>();var clip=new AnimationClip();
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),"flag"),AnimationCurve.Constant(0,1,value));
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),"mirror"),AnimationCurve.Constant(0,1,value));
                clip.SampleAnimation(root,.5f);output.rows.Add(new Row{binding="bool-threshold",key0=value,time=.5f,flag=fields.flag});
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),"mode"),AnimationCurve.Constant(0,1,value));
                clip.SampleAnimation(root,.5f);output.rows.Add(new Row{binding="int-rounding",key0=value,time=.5f,mode=fields.mode,mirror=fields.mirror,mirrorBits=BitConverter.ToInt32(BitConverter.GetBytes(fields.mirror),0)});
                UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(clip);
            }
            foreach(float value in new[]{-15.5f,-4.5f,-3.5f,-2.500001f,-2.5f,-2.499999f,-1.500001f,-1.5f,-1.499999f,BitConverter.ToSingle(BitConverter.GetBytes(unchecked((int)0xbf000001)),0),-.5f,BitConverter.ToSingle(BitConverter.GetBytes(unchecked((int)0xbeffffff)),0),0f,-0f,.5f,1.5f,2.5f}) foreach(bool oneKey in new[]{false,true}) {
                var root=new GameObject("rounding routes");var fields=root.AddComponent<NatsumeAnimatedFields>();var clip=new AnimationClip();clip.name="constant";
                var curve=oneKey?new AnimationCurve(new Keyframe(0,value)):AnimationCurve.Constant(0,1,value);
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),"mode"),curve);
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("",typeof(NatsumeAnimatedFields),"mirror"),curve);
                foreach(float t in new[]{0f,.1f,.25f,.5f,.75f,1f}) {
                    fields.mode=99;clip.SampleAnimation(root,t);
                    output.rows.Add(new Row{binding="round-sample-one"+oneKey,key0=value,time=t,mode=fields.mode,mirror=fields.mirror,mirrorBits=BitConverter.ToInt32(BitConverter.GetBytes(fields.mirror),0)});
                }
                var controller=new AnimatorController();controller.AddLayer("Base Layer");var state=controller.layers[0].stateMachine.AddState("constant");state.motion=clip;
                var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=controller;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;animator.Rebind();
                foreach(float t in new[]{0f,.1f,.25f,.5f,.75f,1f}) {
                    fields.mode=99;animator.Play("constant",0,t);animator.Update(0);
                    output.rows.Add(new Row{binding="round-animator-one"+oneKey,key0=value,time=t,mode=fields.mode,mirror=fields.mirror,mirrorBits=BitConverter.ToInt32(BitConverter.GetBytes(fields.mirror),0)});
                }
                UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(controller);UnityEngine.Object.DestroyImmediate(clip);
            }
            {
                var root=new GameObject("leading key");var target=new GameObject("target");target.transform.SetParent(root.transform);var clip=new AnimationClip();clip.name="leading";
                AnimationUtility.SetEditorCurve(clip,EditorCurveBinding.FloatCurve("target",typeof(GameObject),"m_IsActive"),new AnimationCurve(new Keyframe(1.7f,0),new Keyframe(2,1)));
                foreach(float t in new[]{0f,.5f,1.7f,2f}) {target.SetActive(true);clip.SampleAnimation(root,t);output.rows.Add(new Row{binding="active-leading-sample",time=t,flag=target.activeSelf});}
                var controller=new AnimatorController();controller.AddLayer("Base Layer");var state=controller.layers[0].stateMachine.AddState("leading");state.motion=clip;
                var animator=root.AddComponent<Animator>();animator.runtimeAnimatorController=controller;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;animator.Rebind();
                foreach(float t in new[]{0f,.5f,1.7f,2f}) {target.SetActive(true);animator.Play("leading",0,t/2);animator.Update(0);output.rows.Add(new Row{binding="active-leading-animator",time=t,flag=target.activeSelf});}
                UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(controller);UnityEngine.Object.DestroyImmediate(clip);
            }
            string outputPath=Environment.GetEnvironmentVariable("NATSUME_SCRIPT_FIELDS_OUTPUT");
            if (string.IsNullOrEmpty(outputPath)) throw new Exception("NATSUME_SCRIPT_FIELDS_OUTPUT is required");
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)); File.WriteAllText(outputPath,JsonUtility.ToJson(output,true));
            EditorApplication.Exit(0);
        } catch (Exception e) { Debug.LogException(e); EditorApplication.Exit(1); }
    }
}
