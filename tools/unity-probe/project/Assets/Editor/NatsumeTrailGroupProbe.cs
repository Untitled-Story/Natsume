using System;
using System.Collections.Generic;
using UnityEngine;

/** Checks Ribbon parent grouping after parent and child deaths. */
public static class NatsumeTrailGroupProbe {
    [Serializable] public class Case {
        public bool split, attach, parentDead, childDead;
        public int ribbons;
        public Vector3[] particles, vertices;
        public int[] indices;
    }
    public static Case[] Measure(Camera camera) {
        var rows = new List<Case>();
        camera.orthographic=true; camera.transform.position=new Vector3(0,0,-10); camera.transform.rotation=Quaternion.identity;
        foreach(bool split in new[]{false,true}) foreach(bool attach in new[]{false,true}) foreach(int ribbons in new[]{1,2}) foreach(int death in new[]{0,1,2}) {
            var root=new GameObject("parent");var child=new GameObject("child");var mesh=new Mesh();
            try {
                var parent=root.AddComponent<ParticleSystem>();var p=child.AddComponent<ParticleSystem>();
                foreach(var ps in new[]{parent,p}) {
                    ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);var m=ps.main;m.playOnAwake=false;m.startSpeed=0;m.startLifetime=2;m.loop=false;
                    var e=ps.emission;e.enabled=false;var sh=ps.shape;sh.enabled=false;
                }
                var main=parent.main;main.startLifetime=.1f;
                var em=p.emission;em.SetBursts(new[]{new ParticleSystem.Burst(0,3)});
                var sub=parent.subEmitters;sub.enabled=true;sub.AddSubEmitter(p,ParticleSystemSubEmitterType.Birth,ParticleSystemSubEmitterProperties.InheritNothing);
                var t=p.trails;t.enabled=true;t.mode=ParticleSystemTrailMode.Ribbon;t.ribbonCount=ribbons;t.splitSubEmitterRibbons=split;t.attachRibbonsToTransform=attach;t.widthOverTrail=.25f;t.sizeAffectsWidth=false;
                parent.Simulate(0,true,true,false);
                for(int i=0;i<2;i++) {var ep=new ParticleSystem.EmitParams();ep.position=new Vector3(i*3,0,0);parent.Emit(ep,1);}
                parent.Simulate(.01f,true,false,false);
                var particles=new ParticleSystem.Particle[p.particleCount];p.GetParticles(particles);
                for(int i=0;i<particles.Length;i++) {particles[i].position=new Vector3(i*.4f,(i%2)*.2f,0);particles[i].velocity=Vector3.zero;}
                p.SetParticles(particles,particles.Length);
                if(death>0)parent.Simulate(.11f,true,false,false);
                if(death==2) {p.GetParticles(particles);particles[1].remainingLifetime=-1;p.SetParticles(particles,particles.Length);parent.Simulate(.001f,true,false,false);}
                particles=new ParticleSystem.Particle[p.particleCount];p.GetParticles(particles);
                var positions=new Vector3[particles.Length];for(int i=0;i<particles.Length;i++)positions[i]=particles[i].position;
                p.GetComponent<ParticleSystemRenderer>().BakeTrailsMesh(mesh,camera,true);
                rows.Add(new Case{split=split,attach=attach,ribbons=ribbons,parentDead=death>0,childDead=death==2,particles=positions,vertices=mesh.vertices,indices=mesh.triangles});
            } finally {UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(root);UnityEngine.Object.DestroyImmediate(child);}
        }
        return rows.ToArray();
    }
}
