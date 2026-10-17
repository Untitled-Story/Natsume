using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

// Statistical summaries, not a copy of Unity's random sequence.
public static class NatsumeRandomProbe
{
    const int Count=16384;
    [Serializable] public class Stats {public string name;public double min,max,mean,variance;public int[] bins;}
    [Serializable] public class Correlation {public string a,b;public double value;}
    [Serializable] public class Result {public uint seed;public int count;public float thickness,arc;public Stats[] distributions;public Correlation[] correlations;}
    [Serializable] public class Output {public string unityVersion;public Result[] cases;}
    static Stats Summarize(string name,double[] values)
    {
        double mean=values.Average();var bins=new int[16];foreach(double v in values)bins[Math.Max(0,Math.Min(15,(int)Math.Floor(v*16)))]++;
        return new Stats{name=name,min=values.Min(),max=values.Max(),mean=mean,variance=values.Select(v=>(v-mean)*(v-mean)).Average(),bins=bins};
    }
    static double Corr(double[] a,double[] b)
    {
        double ma=a.Average(),mb=b.Average(),va=0,vb=0,c=0;
        for(int i=0;i<a.Length;i++){double x=a[i]-ma,y=b[i]-mb;va+=x*x;vb+=y*y;c+=x*y;}return va*vb>1e-16?c/Math.Sqrt(va*vb):0;
    }
    static Result Measure(uint seed,float thickness,float arc)
    {
        var go=new GameObject("Random distribution probe");
        try
        {
            var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);ps.useAutoRandomSeed=false;ps.randomSeed=seed;
            var main=ps.main;main.duration=10;main.loop=false;main.playOnAwake=false;main.maxParticles=Count;main.simulationSpace=ParticleSystemSimulationSpace.Local;main.scalingMode=ParticleSystemScalingMode.Local;main.cullingMode=ParticleSystemCullingMode.AlwaysSimulate;
            main.startLifetime=new ParticleSystem.MinMaxCurve(2,4);main.startSpeed=new ParticleSystem.MinMaxCurve(1,3);
            main.startSize3D=true;main.startSizeX=new ParticleSystem.MinMaxCurve(1,3);main.startSizeY=new ParticleSystem.MinMaxCurve(2,6);main.startSizeZ=new ParticleSystem.MinMaxCurve(3,9);
            main.startRotation3D=true;main.startRotationX=new ParticleSystem.MinMaxCurve(0,1);main.startRotationY=new ParticleSystem.MinMaxCurve(0,1);main.startRotationZ=new ParticleSystem.MinMaxCurve(0,1);
            main.startColor=new ParticleSystem.MinMaxGradient(new Color(0,0,0,0),Color.white);
            var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=true;shape.shapeType=ParticleSystemShapeType.Circle;shape.radius=2;shape.radiusThickness=thickness;shape.arc=arc;shape.arcMode=ParticleSystemShapeMultiModeValue.Random;
            var size=ps.sizeOverLifetime;size.enabled=true;size.separateAxes=true;size.x=new ParticleSystem.MinMaxCurve(1,2);size.y=new ParticleSystem.MinMaxCurve(2,4);size.z=new ParticleSystem.MinMaxCurve(3,6);
            var velocity=ps.velocityOverLifetime;velocity.enabled=true;velocity.space=ParticleSystemSimulationSpace.Local;velocity.x=new ParticleSystem.MinMaxCurve(1,2);velocity.y=new ParticleSystem.MinMaxCurve(2,4);velocity.z=new ParticleSystem.MinMaxCurve(3,6);
            go.GetComponent<ParticleSystemRenderer>().enabled=false;ps.Simulate(0,false,true,false);ps.Emit(Count);
            var particles=new ParticleSystem.Particle[Count];int count=ps.GetParticles(particles);if(count!=Count)throw new Exception("Particle count mismatch");
            var columns=new Dictionary<string,double[]>();Action<string,Func<ParticleSystem.Particle,double>> add=(name,get)=>columns.Add(name,particles.Select(get).ToArray());
            add("radiusSquared",p=>p.position.sqrMagnitude/4);add("angle",p=>{double a=Math.Atan2(p.position.y,p.position.x);if(a<0)a+=2*Math.PI;return a/(arc*Math.PI/180);});
            add("lifetime",p=>(p.startLifetime-2)/2);add("speed",p=>(p.velocity.magnitude-1)/2);
            add("sizeX",p=>(p.startSize3D.x-1)/2);add("sizeY",p=>(p.startSize3D.y-2)/4);add("sizeZ",p=>(p.startSize3D.z-3)/6);
            add("rotationX",p=>p.rotation3D.x*Math.PI/180);add("rotationY",p=>p.rotation3D.y*Math.PI/180);add("rotationZ",p=>p.rotation3D.z*Math.PI/180);add("color",p=>((Color)p.startColor).r);
            add("sizeLifeX",p=>p.GetCurrentSize3D(ps).x/p.startSize3D.x-1);add("sizeLifeY",p=>p.GetCurrentSize3D(ps).y/p.startSize3D.y/2-1);add("sizeLifeZ",p=>p.GetCurrentSize3D(ps).z/p.startSize3D.z/3-1);
            const float dt=1f/60f;var before=particles.ToArray();ps.Simulate(dt,false,false,false);ps.GetParticles(particles);
            for(int axis=0;axis<3;axis++){double low=axis+1;var values=new double[Count];for(int i=0;i<Count;i++)values[i]=((particles[i].position[axis]-before[i].position[axis])/dt-before[i].velocity[axis]-low)/low;columns.Add("velocity"+"XYZ"[axis],values);}
            var correlations=new List<Correlation>();var names=columns.Keys.ToArray();for(int i=0;i<names.Length;i++)for(int j=i+1;j<names.Length;j++)correlations.Add(new Correlation{a=names[i],b=names[j],value=Corr(columns[names[i]],columns[names[j]])});
            return new Result{seed=seed,count=count,thickness=thickness,arc=arc,distributions=columns.Select(k=>Summarize(k.Key,k.Value)).ToArray(),correlations=correlations.ToArray()};
        }
        finally{UnityEngine.Object.DestroyImmediate(go);}
    }
    public static void Run()
    {
        try
        {
            if(Application.unityVersion!="2022.3.21f1")throw new Exception("Unexpected Unity version");var cases=new List<Result>();
            foreach(uint seed in new uint[]{12345,98765,24680})foreach(float thickness in new []{0f,0.25f,0.5f,1f})cases.Add(Measure(seed,thickness,360));cases.Add(Measure(13579,1,90));cases.Add(Measure(13579,0.5f,270));
            string output=Path.GetFullPath(Path.Combine(Application.dataPath,"../../unity-baselines/random"));Directory.CreateDirectory(output);File.WriteAllText(Path.Combine(output,"unity-2022.3.21f1.json"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,cases=cases.ToArray()},true));Debug.Log("NATSUME_RANDOM_COMPLETE");
        }
        catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
