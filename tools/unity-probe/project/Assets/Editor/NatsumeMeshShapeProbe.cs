using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

public static class NatsumeMeshShapeProbe
{
    [Serializable] public class Sample { public Vector3 position, velocity; public Color color; }
    [Serializable] public class Case
    {
        public int placement, materialIndex, mode;
        public float normalOffset, spread, speed;
        public bool useMaterialIndex, useMeshColors;
        public int count, firstTriangleCount;
        public double[] mean = new double[10], second = new double[10];
        public List<Sample> samples = new List<Sample>();
    }
    static void Observe(Case c, ParticleSystem.Particle p)
    {
        var color = (Color)p.startColor;
        var values = new double[] { p.position.x,p.position.y,p.position.z,p.velocity.x,p.velocity.y,p.velocity.z,color.r,color.g,color.b,color.a };
        c.count++; if (p.position.x < 2) c.firstTriangleCount++;
        for(int i=0;i<10;i++){c.mean[i]+=values[i];c.second[i]+=values[i]*values[i];}
        if(c.samples.Count<64)c.samples.Add(new Sample{position=p.position,velocity=p.velocity,color=color});
    }
    [Serializable] public class Output
    {
        public string unityVersion;
        public Vector3[] vertices, normals;
        public Color[] colors;
        public int[] triangles;
        public int[] submeshLengths;
        public List<Case> cases = new List<Case>();
        public List<Output> variants = new List<Output>();
    }
    static void Measure(Output output, Case c, Mesh mesh)
    {
        var go = new GameObject("mesh-emission");
        try
        {
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed = false; ps.randomSeed = 12345;
            var main = ps.main;
            main.playOnAwake = false; main.loop = false; main.duration = 4;
            main.startLifetime = 10; main.startSpeed = 1; main.startColor = Color.white;
            main.maxParticles = 8192; main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var emission = ps.emission; emission.enabled = false;
            var shape = ps.shape;
            shape.enabled = true; shape.shapeType = ParticleSystemShapeType.Mesh; shape.mesh = mesh;
            shape.meshShapeType = (ParticleSystemMeshShapeType)c.placement;
            shape.useMeshMaterialIndex = c.useMaterialIndex; shape.meshMaterialIndex = c.materialIndex;
            shape.normalOffset = c.normalOffset; shape.useMeshColors = c.useMeshColors;
            shape.meshSpawnMode = (ParticleSystemShapeMultiModeValue)c.mode;
            shape.meshSpawnSpeed = c.speed; shape.meshSpawnSpread = c.spread;
            ps.Simulate(0, false, true, false);
            var particles = new ParticleSystem.Particle[8192];
            if (c.mode == 0)
            {
                ps.Emit(8192); int count = ps.GetParticles(particles);
                for (int i = 0; i < count; i++) Observe(c,particles[i]);
            }
            else
            {
                for (int i = 0; i < 32; i++)
                {
                    if (i > 0) ps.Simulate(0.125f, false, false, false);
                    ps.Emit(1); int count = ps.GetParticles(particles);
                    if(count>0)Observe(c,particles[count-1]);
                }
            }
            if(c.count>0)for(int i=0;i<10;i++){c.mean[i]/=c.count;c.second[i]/=c.count;}
            output.cases.Add(c);
        }
        finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    public static void Run()
    {
        var mesh = new Mesh();
        try
        {
            mesh.vertices = new[] { new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(4,0,0),new Vector3(6,0,0),new Vector3(4,3,0) };
            mesh.normals = new[] { Vector3.forward, new Vector3(0.6f,0,0.8f),new Vector3(0,0.8f,0.6f),Vector3.up,Vector3.up,Vector3.up };
            mesh.colors = new[] { Color.red,Color.green,Color.blue,Color.cyan,Color.magenta,new Color(1,1,0,0.5f) };
            mesh.subMeshCount = 2; mesh.SetTriangles(new[]{0,1,2},0);mesh.SetTriangles(new[]{3,4,5},1);
            var output = new Output { unityVersion = Application.unityVersion, vertices = mesh.vertices,normals=mesh.normals,colors=mesh.colors,triangles=mesh.triangles,submeshLengths=new[]{3,3} };
            foreach(int placement in new[]{0,1,2})
                foreach(int material in new[]{-1,0,1})
                    foreach(float offset in new[]{0f,0.3f})
                        foreach(bool colors in new[]{false,true})
                            Measure(output,new Case{placement=placement,useMaterialIndex=material>=0,materialIndex=Math.Max(0,material),normalOffset=offset,useMeshColors=colors,speed=1},mesh);
            foreach(int placement in new[]{0,1,2})
                foreach(int mode in new[]{1,2,3})
                    foreach(float spread in new[]{0f,0.25f})
                        Measure(output,new Case{placement=placement,mode=mode,spread=spread,speed=0.7f},mesh);
            foreach(int material in new[]{0,1})
                Measure(output,new Case{placement=0,mode=1,useMaterialIndex=true,materialIndex=material,speed=0.7f},mesh);
            for(int variant=0;variant<3;variant++)
            {
                mesh.Clear(false);
                mesh.vertices = variant==2 ? new[]{Vector3.zero,Vector3.right,Vector3.up,new Vector3(3,2,0),new Vector3(9,9,9)} : new[]{Vector3.zero,Vector3.right,Vector3.up};
                mesh.triangles = variant==1 ? new[]{0,0,0,1,1,1} : variant==2 ? new[]{2,0,1,1,3,2} : new[]{0,1,2};
                if(variant!=0)mesh.RecalculateNormals();
                var extra=new Output{unityVersion=Application.unityVersion,vertices=mesh.vertices,normals=mesh.normals,colors=mesh.colors,triangles=mesh.triangles,submeshLengths=new[]{mesh.triangles.Length}};
                foreach(int placement in new[]{0,1,2})foreach(float offset in new[]{0f,0.3f})foreach(int mode in new[]{0,1})
                    Measure(extra,new Case{placement=placement,normalOffset=offset,mode=mode,speed=0.7f,useMeshColors=false},mesh);
                output.variants.Add(extra);
            }
            var path = Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path,JsonUtility.ToJson(output,true));
        }
        catch(Exception error) { Debug.LogException(error);EditorApplication.Exit(1); }
        finally { UnityEngine.Object.DestroyImmediate(mesh); }
    }
}
