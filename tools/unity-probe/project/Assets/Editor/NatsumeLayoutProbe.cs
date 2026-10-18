using System;
using System.IO;
using UnityEngine;
using UnityEditor;
public static class NatsumeLayoutProbe
{
 [Serializable] public class Output {public string unityVersion;public Vector2 rootSize,childSize;public Vector3 childPosition;}
 public static void Run(){var root=new GameObject("Root",typeof(RectTransform));var child=new GameObject("Child",typeof(RectTransform));try{
  var r=(RectTransform)root.transform;var c=(RectTransform)child.transform;c.SetParent(r,false);
  r.sizeDelta=new Vector2(-100,-200);r.pivot=new Vector2(0.25f,0.75f);
  c.anchorMin=new Vector2(0.1f,0.2f);c.anchorMax=new Vector2(0.8f,0.9f);c.pivot=new Vector2(0.3f,0.6f);c.sizeDelta=new Vector2(-20,0);c.anchoredPosition3D=new Vector3(5,6,7);
  r.ForceUpdateRectTransforms();c.ForceUpdateRectTransforms();
  var o=new Output{unityVersion=Application.unityVersion,rootSize=r.rect.size,childSize=c.rect.size,childPosition=c.localPosition};
  var directory=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/layout"));Directory.CreateDirectory(directory);File.WriteAllText(Path.Combine(directory,"unity-2022.3.21f1.json"),JsonUtility.ToJson(o,true));
 }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}finally{UnityEngine.Object.DestroyImmediate(root);}}
}
