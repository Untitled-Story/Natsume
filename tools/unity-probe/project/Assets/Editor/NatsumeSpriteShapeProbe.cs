using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeSpriteShapeProbe {
    [Serializable] public class Sample {
        public string label;
        public bool donut, empty;
        public int placement, mode;
        public float thickness, normalOffset, radius, tube, arc, time, speed=1, spread;
        public int count=8192;
        public Vector3[] positions, velocities;
    }
    [Serializable] public class Output {
        public string unityVersion;
        public Vector2[] vertices;
        public ushort[] triangles;
        public Sample[] cases;
    }
    public static void Run() {
        var texture = new Texture2D(16,16);
        texture.SetPixels(Enumerable.Repeat(Color.white,256).ToArray()); texture.Apply();
        var sprite = Sprite.Create(texture,new Rect(0,0,16,8),new Vector2(.5f,.5f),4);
        var cases = new List<Sample>();
        Action<Sample> capture = c => {
            var go = new GameObject(c.label);
            try {
                var ps = go.AddComponent<ParticleSystem>();
                ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                ps.useAutoRandomSeed=false; ps.randomSeed=12345;
                var main=ps.main; main.playOnAwake=false; main.loop=false; main.startLifetime=10; main.startSpeed=1; main.maxParticles=8192;
                var emission=ps.emission; emission.enabled=false;
                var shape=ps.shape; shape.enabled=true;
                if(c.donut) {
                    shape.shapeType=ParticleSystemShapeType.Donut;
                    shape.radius=c.radius; shape.donutRadius=c.tube; shape.radiusThickness=c.thickness;
                    shape.arc=c.arc; shape.arcMode=(ParticleSystemShapeMultiModeValue)c.mode; shape.arcSpeed=1;
                } else {
                    shape.shapeType=ParticleSystemShapeType.Sprite; shape.sprite=c.empty?null:sprite;
                    shape.meshShapeType=(ParticleSystemMeshShapeType)c.placement;
                    shape.normalOffset=c.normalOffset;
                    shape.meshSpawnMode=(ParticleSystemShapeMultiModeValue)c.mode; shape.meshSpawnSpeed=c.speed; shape.meshSpawnSpread=c.spread;
                }
                ps.GetComponent<ParticleSystemRenderer>().enabled=false;
                ps.Simulate(c.time,false,true,false); ps.Emit(c.count);
                var particles=new ParticleSystem.Particle[8192]; var count=ps.GetParticles(particles);
                c.positions=particles.Take(count).Select(p=>p.position).ToArray();
                c.velocities=particles.Take(count).Select(p=>p.velocity).ToArray();
                cases.Add(c);
            } finally { UnityEngine.Object.DestroyImmediate(go); }
        };
        foreach(float thickness in new[]{0f,.25f,1f})
            foreach(float arc in new[]{90f,360f})
                capture(new Sample{label="donut-"+thickness+"-"+arc,donut=true,radius=2,tube=.5f,thickness=thickness,arc=arc});
        foreach(int mode in new[]{1,2,3})
            capture(new Sample{label="donut-sweep-"+mode,donut=true,radius=2,tube=.5f,thickness=1,arc=180,mode=mode,time=.25f});
        foreach(int placement in new[]{0,1,2})
            foreach(float offset in new[]{0f,.3f})
                capture(new Sample{label="sprite-"+placement+"-"+offset,placement=placement,normalOffset=offset});
        foreach(int mode in new[]{1,2,3})
            foreach(int placement in new[]{0,1,2})
                capture(new Sample{label="sprite-sweep-"+mode+"-"+placement,placement=placement,mode=mode,time=.25f});
        foreach(int placement in new[]{0,1,2})
            foreach(int mode in new[]{1,2,3})
                foreach(float time in new[]{0f,.125f,.5f})
                    capture(new Sample{label="sprite-time-"+placement+"-"+mode+"-"+time,placement=placement,mode=mode,time=time,speed=2,spread=.25f,count=16});
        capture(new Sample{label="sprite-empty",empty=true,count=16});
        File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(new Output{unityVersion=Application.unityVersion,vertices=sprite.vertices,triangles=sprite.triangles,cases=cases.ToArray()},true));
        UnityEngine.Object.DestroyImmediate(sprite); UnityEngine.Object.DestroyImmediate(texture);
    }
}
