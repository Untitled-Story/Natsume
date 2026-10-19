using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

public static class NatsumeRenderOrderProbe
{
    [Serializable] public class SystemSpec { public int[] queues; public int order; public float fudge, z; }
    [Serializable] public class Sample { public string label; public SystemSpec[] systems; public int[] pixels; public bool reverseMaterials, sharedMaterial; }
    static SystemSpec S(int[] queues, int order=0, float fudge=0, float z=0) { return new SystemSpec {queues=queues,order=order,fudge=fudge,z=z}; }
    public static Sample[] Measure(Camera camera)
    {
        var cases = new List<Sample> {
            new Sample {label="queue-forward",systems=new[]{S(new[]{3000}),S(new[]{3100})}},
            new Sample {label="queue-reverse",systems=new[]{S(new[]{3100}),S(new[]{3000})}},
            new Sample {label="queue-interleave",systems=new[]{S(new[]{3000,3200}),S(new[]{3100})}},
            new Sample {label="queue-slot-reverse",systems=new[]{S(new[]{3200,3000}),S(new[]{3100})}},
            new Sample {label="order-over-queue",systems=new[]{S(new[]{3100},-1),S(new[]{3000},1)}},
            new Sample {label="order-reverse",systems=new[]{S(new[]{3000},1),S(new[]{3000},-1)}},
            new Sample {label="fudge-forward",systems=new[]{S(new[]{3000},0,1),S(new[]{3000},0,-1)}},
            new Sample {label="queue-over-fudge",systems=new[]{S(new[]{3100},0,1),S(new[]{3000},0,-1)}},
            new Sample {label="order-over-fudge",systems=new[]{S(new[]{3000},-1,-1),S(new[]{3000},1,1)}},
            new Sample {label="depth-forward",systems=new[]{S(new[]{3000},0,0,1),S(new[]{3000},0,0,3)}},
            new Sample {label="depth-reverse",systems=new[]{S(new[]{3000},0,0,3),S(new[]{3000},0,0,1)}},
            new Sample {label="depth-small-fudge",systems=new[]{S(new[]{3000},0,-.1f,1),S(new[]{3000},0,0,3)}},
            new Sample {label="depth-large-fudge",systems=new[]{S(new[]{3000},0,-4,1),S(new[]{3000},0,0,3)}},
            new Sample {label="depth-positive-fudge",systems=new[]{S(new[]{3000},0,4,3),S(new[]{3000},0,0,1)}},
            new Sample {label="near-small-positive-fudge",systems=new[]{S(new[]{3000},0,.1f,1),S(new[]{3000},0,0,3)}},
            new Sample {label="near-large-positive-fudge",systems=new[]{S(new[]{3000},0,4,1),S(new[]{3000},0,0,3)}},
            new Sample {label="far-small-negative-fudge",systems=new[]{S(new[]{3000},0,-.1f,3),S(new[]{3000},0,0,1)}},
            new Sample {label="far-large-negative-fudge",systems=new[]{S(new[]{3000},0,-4,3),S(new[]{3000},0,0,1)}},
            new Sample {label="opaque-queue-order",systems=new[]{S(new[]{2100}),S(new[]{2000})}},
            new Sample {label="opaque-depth-forward",systems=new[]{S(new[]{2000},0,0,1),S(new[]{2000},0,0,3)}},
            new Sample {label="opaque-depth-reverse",systems=new[]{S(new[]{2000},0,0,3),S(new[]{2000},0,0,1)}},
            new Sample {label="opaque-depth-fudge",systems=new[]{S(new[]{2000},0,4,1),S(new[]{2000},0,0,3)}},
        };
        foreach(float z in new[]{2f,8f,32f,128f,512f})
            foreach(bool reverse in new[]{false,true})
                cases.Add(new Sample{label="opaque-separation-"+z+"-"+reverse,systems=new[]{S(new[]{2000},0,0,1),S(new[]{2000},0,0,z)},reverseMaterials=reverse});
        cases.Add(new Sample{label="opaque-shared-forward",systems=new[]{S(new[]{2000},0,0,1),S(new[]{2000},0,0,3)},sharedMaterial=true});
        cases.Add(new Sample{label="opaque-shared-reverse",systems=new[]{S(new[]{2000},0,0,3),S(new[]{2000},0,0,1)},sharedMaterial=true});
        cases.Add(new Sample{label="opaque-shared-fudge",systems=new[]{S(new[]{2000},0,4,1),S(new[]{2000},0,0,3)},sharedMaterial=true});
        cases.Add(new Sample{label="opaque-order-over-material",systems=new[]{S(new[]{2000},-1),S(new[]{2000},1)}});
        cases.Add(new Sample{label="opaque-queue-interleave",systems=new[]{S(new[]{2000,2200}),S(new[]{2100})}});
        cases.Add(new Sample{label="opaque-slot-reverse",systems=new[]{S(new[]{2200,2000}),S(new[]{2100})}});
        cases.Add(new Sample{label="queue-threshold-2500",systems=new[]{S(new[]{2500},0,0,1),S(new[]{2500},0,0,3)}});
        cases.Add(new Sample{label="queue-threshold-2501",systems=new[]{S(new[]{2501},0,0,1),S(new[]{2501},0,0,3)}});
        cases.Add(new Sample{label="queue-stage-order-forward",systems=new[]{S(new[]{3000},-10),S(new[]{2000},10)}});
        cases.Add(new Sample{label="queue-stage-order-reverse",systems=new[]{S(new[]{2000},10),S(new[]{3000},-10)}});
        cases.Add(new Sample{label="queue-threshold-reverse-materials",systems=new[]{S(new[]{2501},0,0,1),S(new[]{2501},0,0,3)},reverseMaterials=true});
        var rt=new RenderTexture(32,32,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);
        var image=new Texture2D(32,32,TextureFormat.RGBA32,false,true);
        camera.targetTexture=rt;camera.orthographic=true;camera.orthographicSize=2;camera.aspect=1;
        camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.black;
        camera.transform.position=new Vector3(0,0,-10);
        camera.farClipPlane=10000;
        var colors=new[]{Color.red,Color.green,Color.blue,Color.yellow};
        try {
            foreach(var sample in cases) {
                var objects=new List<GameObject>();var materials=new List<Material>();
                try {
                    var materialMap=new Dictionary<int,Material>();
                    var materialIndices=Enumerable.Range(0,sample.systems.Length).SelectMany(i=>Enumerable.Range(0,sample.systems[i].queues.Length).Select(j=>i*2+j)).ToArray();
                    if(sample.reverseMaterials)Array.Reverse(materialIndices);
                    foreach(int key in materialIndices){
                        var color=sample.sharedMaterial?Color.white:colors[key];color.a=.5f;
                        var material=new Material(Shader.Find("Hidden/Internal-Colored")){color=color,renderQueue=sample.systems[key/2].queues[key%2]};
                        material.SetInt("_Cull",0);material.SetInt("_ZWrite",0);material.SetInt("_SrcBlend",5);material.SetInt("_DstBlend",10);material.SetInt("_ZTest",8);
                        materials.Add(material);materialMap[key]=material;
                    }
                    for(int i=0;i<sample.systems.Length;i++) {
                        var spec=sample.systems[i];var go=new GameObject(sample.label+i);objects.Add(go);
                        var ps=go.AddComponent<ParticleSystem>();ps.Stop(false,ParticleSystemStopBehavior.StopEmittingAndClear);
                        var main=ps.main;main.playOnAwake=false;main.startSpeed=0;main.startLifetime=10;main.simulationSpace=ParticleSystemSimulationSpace.World;
                        var emission=ps.emission;emission.enabled=false;var shape=ps.shape;shape.enabled=false;
                        var renderer=ps.GetComponent<ParticleSystemRenderer>();renderer.maxParticleSize=100;renderer.sortingOrder=spec.order;renderer.sortingFudge=spec.fudge;
                        var passes=new List<Material>();
                        for(int j=0;j<spec.queues.Length;j++){
                            passes.Add(materialMap[sample.sharedMaterial?0:i*2+j]);
                        }
                        renderer.sharedMaterials=passes.Count==1?passes.ToArray():new[]{passes[0],passes[0],passes[1]};
                        ps.Simulate(0,false,true,false);
                        ps.SetParticles(new[]{new ParticleSystem.Particle{position=new Vector3(0,0,spec.z),startSize=2,startColor=sample.sharedMaterial?colors[i*2]:Color.white,startLifetime=10,remainingLifetime=10,randomSeed=1}},1);
                    }
                    camera.Render();RenderTexture.active=rt;image.ReadPixels(new Rect(0,0,32,32),0,0);image.Apply();
                    var pixel=image.GetPixel(16,16);sample.pixels=new[]{Mathf.RoundToInt(pixel.r*255),Mathf.RoundToInt(pixel.g*255),Mathf.RoundToInt(pixel.b*255)};
                }finally{foreach(var go in objects)UnityEngine.Object.DestroyImmediate(go);foreach(var material in materials)UnityEngine.Object.DestroyImmediate(material);}
            }
            return cases.ToArray();
        }finally{camera.targetTexture=null;RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(rt);UnityEngine.Object.DestroyImmediate(image);}
    }
}
