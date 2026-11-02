using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeRendererShapeProbe
{
    [Serializable] public class Sample { public Vector3 position, velocity; public Color color; }
    [Serializable] public class Case {
        public bool sprite, enabled, active, flipX, flipY, transformedShape;
        public int space, scaling, frame, variant, actualSpace;
        public float normalOffset;
        public Matrix4x4 sourceMatrix, emitterMatrix, customMatrix; public Vector3 sourceScale;
        public List<Sample> samples = new List<Sample>();
    }
    [Serializable] public class Output { public string unityVersion; public Vector3[] vertices, normals; public Vector2[] spriteVertices; public ushort[] spriteTriangles; public List<Case> cases = new List<Case>(); }
    public static void Run() {
        var mesh = new Mesh(); var texture = new Texture2D(16,16);
        texture.SetPixels(new Color[256]); texture.Apply();
        var sprite = Sprite.Create(texture,new Rect(0,0,16,16),new Vector2(0.5f,0.5f),1);
        mesh.vertices = new[]{new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,2,0)};
        mesh.normals = new[]{new Vector3(0.6f,0,0.8f),Vector3.up,Vector3.forward};
        mesh.triangles = new[]{0,1,2}; mesh.colors = new[]{Color.red,Color.green,Color.blue};
        var output = new Output{unityVersion=Application.unityVersion,vertices=mesh.vertices,normals=mesh.normals,spriteVertices=sprite.vertices,spriteTriangles=sprite.triangles};
        try {
            foreach(bool isSprite in new[]{false,true}) foreach(int space in new[]{0,1,2}) foreach(int scaling in new[]{0,1,2}) foreach(int variant in new[]{0,1,2,3,4,5,6,7,8,9,10,11}) {
                var source = new GameObject("source"); var go = new GameObject("particles"); var custom = new GameObject("custom"); var parent = new GameObject("parent");
                try {
                    source.transform.SetPositionAndRotation(new Vector3(3,-2,1),Quaternion.Euler(20,35,15)); source.transform.localScale=new Vector3(2,3,0.5f);
                    go.transform.SetPositionAndRotation(new Vector3(-1,2,0.5f),Quaternion.Euler(10,20,-30)); go.transform.localScale=new Vector3(1.5f,0.75f,2);
                    custom.transform.SetPositionAndRotation(new Vector3(2,1,-1),Quaternion.Euler(0,15,10)); custom.transform.localScale=new Vector3(0.8f,1.2f,1.5f);
                    if(variant==6){source.transform.SetParent(parent.transform,false);parent.transform.SetPositionAndRotation(new Vector3(1,2,3),Quaternion.Euler(5,10,15));parent.transform.localScale=new Vector3(2,0.5f,1.5f);}
                    if(variant==7)source.transform.localScale=new Vector3(-2,3,0.5f);
                    if(variant==8)source.transform.localScale=Vector3.zero;
                    Renderer renderer;
                    if(isSprite) { var sr=source.AddComponent<SpriteRenderer>(); sr.sprite=sprite; if(variant>=9){sr.drawMode=variant==9?SpriteDrawMode.Sliced:SpriteDrawMode.Tiled;sr.size=new Vector2(25,30);}
                    sr.flipX=variant==3; sr.flipY=variant==4; sr.color=new Color(0.2f,0.4f,0.7f,0.5f); renderer=sr; }
                    else { source.AddComponent<MeshFilter>().sharedMesh=mesh; renderer=source.AddComponent<MeshRenderer>(); }
                    renderer.enabled=variant!=1; source.SetActive(variant!=2);
                    var ps=go.AddComponent<ParticleSystem>(); ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear); ps.useAutoRandomSeed=false; ps.randomSeed=12345;
                    var main=ps.main; main.playOnAwake=false; main.startLifetime=10; main.startSpeed=1; main.startColor=Color.white; main.maxParticles=32; main.customSimulationSpace=custom.transform; main.simulationSpace=(ParticleSystemSimulationSpace)space; main.scalingMode=(ParticleSystemScalingMode)scaling;
                    var emission=ps.emission; emission.enabled=false; var shape=ps.shape; shape.shapeType=isSprite?ParticleSystemShapeType.SpriteRenderer:ParticleSystemShapeType.MeshRenderer;
                    if(isSprite)shape.spriteRenderer=(SpriteRenderer)renderer; else shape.meshRenderer=(MeshRenderer)renderer;
                    shape.meshShapeType=ParticleSystemMeshShapeType.Vertex; shape.meshSpawnMode=ParticleSystemShapeMultiModeValue.Loop; shape.useMeshColors=true; shape.normalOffset=0.3f;
                    if(variant==5){shape.position=new Vector3(0.2f,0.4f,-0.1f);shape.rotation=new Vector3(15,20,30);shape.scale=new Vector3(0.5f,2,1.5f);}
                    ps.Simulate(0,false,true,false);
                    for(int frame=0;frame<2;frame++) {
                        if(frame==1){source.transform.position+=new Vector3(-2,1,3);source.transform.rotation=Quaternion.Euler(-10,50,25);source.transform.localScale=new Vector3(0.5f,2,3);}
                        if(frame==1 && variant==11)UnityEngine.Object.DestroyImmediate(renderer);
                        ps.Clear(false); ps.Emit(3); var particles=new ParticleSystem.Particle[32]; int count=ps.GetParticles(particles);
                        var c=new Case{variant=variant,actualSpace=(int)ps.main.simulationSpace,customMatrix=custom.transform.localToWorldMatrix,sourceScale=source.transform.lossyScale,sprite=isSprite,enabled=renderer && renderer.enabled,active=source.activeSelf,flipX=variant==3,flipY=variant==4,transformedShape=variant==5,space=space,scaling=scaling,frame=frame,normalOffset=0.3f,sourceMatrix=source.transform.localToWorldMatrix,emitterMatrix=go.transform.localToWorldMatrix};
                        for(int i=0;i<count;i++)c.samples.Add(new Sample{position=particles[i].position,velocity=particles[i].velocity,color=particles[i].startColor}); output.cases.Add(c);
                    }
                } finally { UnityEngine.Object.DestroyImmediate(go); UnityEngine.Object.DestroyImmediate(source); UnityEngine.Object.DestroyImmediate(custom); UnityEngine.Object.DestroyImmediate(parent); }
            }
            var path=Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,JsonUtility.ToJson(output,true));
        } catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);} finally {UnityEngine.Object.DestroyImmediate(sprite);UnityEngine.Object.DestroyImmediate(texture);UnityEngine.Object.DestroyImmediate(mesh);}
    }
}
