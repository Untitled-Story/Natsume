using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;

/// <summary>Native drawing of translations of the retained Metal equations and Pass tags.</summary>
public static class NatsumeSourceMaterialProbe {
    [Serializable] public class Sample {
        public string label;public bool linear;public float surface;public float[] tint,vertex,st;
        public int src,dst,srcAlpha,dstAlpha,op;public int[] pixels;
    }
    [Serializable] public class Builtin {
        public string name,guid,path,rawPixelsError;public long fileId;
        public int width,height,filterMode,wrapModeU,wrapModeV,mipmapCount;public bool isDataSRGB;
        public int[] pixels,sourcePixels;public List<Mip> mips=new List<Mip>();
    }
    [Serializable] public class Mip {public int level,width,height;public int[] pixels;}
    [Serializable] public class HdrSample {
        public string label,format;public int width,height;public float max,min,maxGpuDifference;public bool cpuReference;
        public List<HdrPixel> pixels=new List<HdrPixel>();
    }
    [Serializable] public class HdrPixel {public int x,y;public float[] value;}
    [Serializable] public class TextureMetadata {public int m_Width,m_Height,m_TextureFormat,m_MipCount;}
    [Serializable] public class PassEnable {public string program,key;public int[] pixel;}
    [Serializable] public class FilterSample {public string label;public bool linear;public int size;public float bias;public int[] pixels;}
    [Serializable] public class Output {
        public string unityVersion,evidence="ShaderLab translations of retained Metal equations; not execution of the original compiled Shader assets";
        public List<Sample> cases=new List<Sample>();public List<Builtin> builtins=new List<Builtin>();
        public List<HdrSample> hdr=new List<HdrSample>();
        public List<PassEnable> passEnable=new List<PassEnable>();
        public List<FilterSample> builtinFilters=new List<FilterSample>();
        public bool supportsSourceAstc;
        public int[] forwardPixel,depthOnlyForwardPixel,depthOnlyExplicitPixel;
    }
    static int[] Read(RenderTexture target){
        var previous=RenderTexture.active;RenderTexture.active=target;
        var read=new Texture2D(target.width,target.height,TextureFormat.RGBA32,false,true);
        read.ReadPixels(new Rect(0,0,target.width,target.height),0,0);read.Apply();
        var bytes=new int[target.width*target.height*4];var colors=read.GetPixels32();
        for(int y=0;y<target.height;y++)for(int x=0;x<target.width;x++){
            var c=colors[(target.height-1-y)*target.width+x];int i=(y*target.width+x)*4;
            bytes[i]=c.r;bytes[i+1]=c.g;bytes[i+2]=c.b;bytes[i+3]=c.a;
        }
        UnityEngine.Object.DestroyImmediate(read);RenderTexture.active=previous;return bytes;
    }
    static float[] Components(Color c){return new[]{c.r,c.g,c.b,c.a};}
    static Mesh Quad(Color color){
        var mesh=new Mesh();mesh.vertices=new[]{new Vector3(-1,-1,0),new Vector3(1,-1,0),new Vector3(1,1,0),new Vector3(-1,1,0)};
        mesh.uv=new[]{Vector2.zero,Vector2.right,Vector2.one,Vector2.up};mesh.colors=new[]{color,color,color,color};mesh.triangles=new[]{0,1,2,0,2,3};return mesh;
    }
    static void Builtins(Output output){
        var seen=new HashSet<int>();var all=new List<UnityEngine.Object>();
        foreach(string path in new[]{"Resources/unity_builtin_extra","Library/unity default resources"})all.AddRange(AssetDatabase.LoadAllAssetsAtPath(path));
        foreach(string name in new[]{"Default-Particle.psd"}){
            var texture=AssetDatabase.GetBuiltinExtraResource<Texture2D>(name);if(texture)all.Add(texture);
        }
        foreach(var obj in all){
            var texture=obj as Texture2D;if(!texture||!seen.Add(texture.GetInstanceID()))continue;
            string guid;long fileId;if(!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(texture,out guid,out fileId))continue;
            if(fileId!=10300)continue;
            var target=new RenderTexture(texture.width,texture.height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.Create();
            Graphics.Blit(texture,target);var bytes=Read(target);
            var entry=new Builtin{name=texture.name,guid=guid,fileId=fileId,path=AssetDatabase.GetAssetPath(texture),width=texture.width,height=texture.height,pixels=bytes,filterMode=(int)texture.filterMode,wrapModeU=(int)texture.wrapModeU,wrapModeV=(int)texture.wrapModeV,mipmapCount=texture.mipmapCount,isDataSRGB=texture.isDataSRGB};
            var material=new Material(Shader.Find("Hidden/NatsumeSourceParticle"));material.SetTexture("_BaseMap",texture);material.SetColor("_BaseColor",Color.white);material.SetFloat("_Surface",1);
            material.SetFloat("_SrcBlend",1);material.SetFloat("_DstBlend",0);material.SetFloat("_SrcBlendAlpha",1);material.SetFloat("_DstBlendAlpha",0);
            var quad=Quad(Color.white);RenderTexture.active=target;GL.Clear(true,true,Color.clear);GL.PushMatrix();GL.LoadProjectionMatrix(Matrix4x4.identity);GL.modelview=Matrix4x4.identity;
            material.SetPass(0);Graphics.DrawMeshNow(quad,Matrix4x4.identity);GL.PopMatrix();entry.sourcePixels=Read(target);UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(quad);
            try{
                for(int mip=0;mip<texture.mipmapCount;mip++){
                    int width=Math.Max(1,texture.width>>mip),height=Math.Max(1,texture.height>>mip);var colors=texture.GetPixels32(mip);var values=new int[colors.Length*4];
                    for(int y=0;y<height;y++)for(int x=0;x<width;x++){
                        var c=colors[(height-1-y)*width+x];int i=(y*width+x)*4;values[i]=c.r;values[i+1]=c.g;values[i+2]=c.b;values[i+3]=c.a;
                    }
                    entry.mips.Add(new Mip{level=mip,width=width,height=height,pixels=values});
                }
            }catch(Exception e){
                entry.rawPixelsError=e.Message;entry.mips.Clear();var mipMaterial=new Material(Shader.Find("Hidden/NatsumeSourceMip"));mipMaterial.SetTexture("_BaseMap",texture);var mipQuad=Quad(Color.white);
                try{for(int mip=0;mip<texture.mipmapCount;mip++){
                    int width=Math.Max(1,texture.width>>mip),height=Math.Max(1,texture.height>>mip);var mipTarget=new RenderTexture(width,height,0,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);mipTarget.Create();
                    RenderTexture.active=mipTarget;GL.Clear(false,true,Color.clear);GL.PushMatrix();GL.LoadProjectionMatrix(Matrix4x4.identity);GL.modelview=Matrix4x4.identity;mipMaterial.SetFloat("_Mip",mip);mipMaterial.SetPass(0);Graphics.DrawMeshNow(mipQuad,Matrix4x4.identity);GL.PopMatrix();
                    entry.mips.Add(new Mip{level=mip,width=width,height=height,pixels=Read(mipTarget)});RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(mipTarget);
                }}finally{UnityEngine.Object.DestroyImmediate(mipMaterial);UnityEngine.Object.DestroyImmediate(mipQuad);}
            }
            output.builtins.Add(entry);
            RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(target);
        }
    }
    public static void Run(){
        var output=new Output{unityVersion=Application.unityVersion};var original=PlayerSettings.colorSpace;
        var previousTarget=RenderTexture.active;var previousPipeline=GraphicsSettings.renderPipelineAsset;
        try{
            GraphicsSettings.renderPipelineAsset=null;PlayerSettings.colorSpace=ColorSpace.Gamma;Builtins(output);
            BuiltinFilters(output);
            Hdr(output);
            var texture=new Texture2D(2,2,TextureFormat.RGBA32,false,false);texture.filterMode=FilterMode.Point;texture.wrapMode=TextureWrapMode.Clamp;
            texture.SetPixels32(new[]{new Color32(204,51,153,128),new Color32(26,179,77,230),new Color32(77,128,230,51),new Color32(230,204,26,179)});texture.Apply();
            var target=new RenderTexture(8,8,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.Create();
            var material=new Material(Shader.Find("Hidden/NatsumeSourceParticle"));
            try{
                foreach(bool linear in new[]{false,true})foreach(float surface in new[]{0f,1f,.5f})foreach(int mode in new[]{0,1,2})foreach(bool transformed in new[]{false,true}){
                    PlayerSettings.colorSpace=linear?ColorSpace.Linear:ColorSpace.Gamma;
                    var tint=mode==2?new Color(1.3f,.6f,.2f,.7f):new Color(.7f,.4f,.9f,.6f);
                    var vertex=mode==2?new Color(.6f,1.2f,.7f,.8f):new Color(.8f,.7f,.6f,.5f);
                    var mesh=Quad(vertex);material.SetTexture("_BaseMap",texture);material.SetColor("_BaseColor",tint);material.SetFloat("_Surface",surface);
                    var st=transformed?new Vector4(.25f,.7f,.4f,.1f):new Vector4(1,1,0,0);
                    material.SetTextureScale("_BaseMap",new Vector2(st.x,st.y));material.SetTextureOffset("_BaseMap",new Vector2(st.z,st.w));
                    int src=mode==1?5:1,dst=mode==1?10:0,srcAlpha=1,dstAlpha=mode==1?10:0;
                    material.SetFloat("_SrcBlend",src);material.SetFloat("_DstBlend",dst);material.SetFloat("_SrcBlendAlpha",srcAlpha);material.SetFloat("_DstBlendAlpha",dstAlpha);
                    RenderTexture.active=target;GL.Clear(true,true,new Color(.12f,.23f,.34f,.45f));
                    GL.PushMatrix();GL.LoadProjectionMatrix(Matrix4x4.identity);GL.modelview=Matrix4x4.identity;
                    if(!material.SetPass(0))throw new Exception("Cannot set translated source pass");Graphics.DrawMeshNow(mesh,Matrix4x4.identity);GL.PopMatrix();
                    output.cases.Add(new Sample{label=(linear?"linear":"gamma")+"/surface"+surface+"/mode"+mode+"/st"+transformed,linear=linear,surface=surface,tint=Components(tint),vertex=Components(vertex),st=new[]{st.x,st.y,st.z,st.w},src=src,dst=dst,srcAlpha=srcAlpha,dstAlpha=dstAlpha,op=0,pixels=Read(target)});
                    UnityEngine.Object.DestroyImmediate(mesh);
                }
            }finally{RenderTexture.active=null;UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(texture);UnityEngine.Object.DestroyImmediate(target);}
            Selection(output);
            File.WriteAllText(Environment.GetEnvironmentVariable("NATSUME_COMPAT_OUTPUT"),JsonUtility.ToJson(output));
        }catch(Exception e){Debug.LogException(e);EditorApplication.Exit(1);}
        finally{PlayerSettings.colorSpace=original;GraphicsSettings.renderPipelineAsset=previousPipeline;RenderTexture.active=previousTarget;}
    }
    static void BuiltinFilters(Output output){
        var texture=AssetDatabase.GetBuiltinExtraResource<Texture2D>("Default-Particle.psd");var material=new Material(Shader.Find("Hidden/NatsumeSourceParticle"));material.SetTexture("_BaseMap",texture);material.SetColor("_BaseColor",Color.white);material.SetFloat("_Surface",1);material.SetFloat("_SrcBlend",1);material.SetFloat("_DstBlend",0);material.SetFloat("_SrcBlendAlpha",1);material.SetFloat("_DstBlendAlpha",0);var quad=Quad(Color.white);var old=RenderTexture.active;
        try{foreach(bool linear in new[]{false,true})foreach(int size in new[]{64,16,4})foreach(float bias in new[]{0f,1f,-1f}){
            PlayerSettings.colorSpace=linear?ColorSpace.Linear:ColorSpace.Gamma;material.SetFloat("_GlobalMipBias",bias);var target=new RenderTexture(size,size,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.Create();
            RenderTexture.active=target;GL.Clear(true,true,Color.clear);GL.PushMatrix();GL.LoadProjectionMatrix(Matrix4x4.identity);GL.modelview=Matrix4x4.identity;material.SetPass(0);Graphics.DrawMeshNow(quad,Matrix4x4.identity);GL.PopMatrix();
            output.builtinFilters.Add(new FilterSample{label=(linear?"linear":"gamma")+"/"+size+"/"+bias,linear=linear,size=size,bias=bias,pixels=Read(target)});RenderTexture.active=old;UnityEngine.Object.DestroyImmediate(target);
        }}finally{RenderTexture.active=old;PlayerSettings.colorSpace=ColorSpace.Gamma;UnityEngine.Object.DestroyImmediate(material);UnityEngine.Object.DestroyImmediate(quad);}
    }
    static void Hdr(Output output){
        var texture=new Texture2D(2,2,TextureFormat.RGBAHalf,false,true);texture.filterMode=FilterMode.Point;texture.wrapMode=TextureWrapMode.Clamp;
        texture.SetPixels(new[]{new Color(1.1875f,.25f,0,.5f),new Color(.5f,1.0625f,.75f,1),new Color(0,.5f,2,.25f),new Color(.1f,.2f,.3f,.4f)});texture.Apply();
        try{HdrTexture(output,"synthetic-half",texture);}finally{UnityEngine.Object.DestroyImmediate(texture);}
        var source=Environment.GetEnvironmentVariable("NATSUME_SOURCE_HDR");if(string.IsNullOrEmpty(source))return;
        const string path="Assets/NatsumeSourceHdr.exr";File.Copy(source,path,true);AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport|ImportAssetOptions.ForceUpdate);
        var importer=(TextureImporter)AssetImporter.GetAtPath(path);importer.sRGBTexture=false;importer.isReadable=true;importer.mipmapEnabled=false;importer.textureCompression=TextureImporterCompression.Uncompressed;importer.filterMode=FilterMode.Point;importer.wrapMode=TextureWrapMode.Clamp;importer.SaveAndReimport();
        HdrTexture(output,"imported-exr",AssetDatabase.LoadAssetAtPath<Texture2D>(path));
        var rawPath=Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(source)),Path.GetFileNameWithoutExtension(source)+".texture.bin");
        var metadataPath=Path.ChangeExtension(rawPath,".json");
        if(File.Exists(rawPath)&&File.Exists(metadataPath)){
            var metadata=JsonUtility.FromJson<TextureMetadata>(File.ReadAllText(metadataPath));output.supportsSourceAstc=SystemInfo.SupportsTextureFormat((TextureFormat)metadata.m_TextureFormat);
            if(output.supportsSourceAstc){
                var original=new Texture2D(metadata.m_Width,metadata.m_Height,(TextureFormat)metadata.m_TextureFormat,metadata.m_MipCount>1,true);original.LoadRawTextureData(File.ReadAllBytes(rawPath));original.Apply(false,false);original.filterMode=FilterMode.Point;
                try{HdrTexture(output,"original-astc",original,false);}finally{UnityEngine.Object.DestroyImmediate(original);}
            }
        }
    }
    static void HdrTexture(Output output,string label,Texture2D texture,bool compareCpu=true){
        var colors=compareCpu?texture.GetPixels():null;var target=new RenderTexture(texture.width,texture.height,0,RenderTextureFormat.ARGBFloat,RenderTextureReadWrite.Linear);target.Create();
        var previous=RenderTexture.active;var read=new Texture2D(texture.width,texture.height,TextureFormat.RGBAFloat,false,true);
        try{
            Graphics.Blit(texture,target);RenderTexture.active=target;read.ReadPixels(new Rect(0,0,texture.width,texture.height),0,0);read.Apply();var gpu=read.GetPixels();
            if(colors==null)colors=gpu;
            var sample=new HdrSample{label=label,width=texture.width,height=texture.height,format=texture.format.ToString(),min=float.PositiveInfinity,max=float.NegativeInfinity,cpuReference=compareCpu};
            int maximumIndex=0;
            for(int i=0;i<colors.Length;i++)for(int c=0;c<4;c++){
                float v=colors[i][c];if(v>sample.max){sample.max=v;maximumIndex=i;}sample.min=Math.Min(sample.min,v);sample.maxGpuDifference=Math.Max(sample.maxGpuDifference,Math.Abs(gpu[i][c]-v));
            }
            foreach(int index in new[]{0,texture.width-1,colors.Length-texture.width,colors.Length-1,(texture.height/2)*texture.width+texture.width/2,maximumIndex})sample.pixels.Add(new HdrPixel{x=index%texture.width,y=texture.height-1-index/texture.width,value=Components(gpu[index])});
            output.hdr.Add(sample);
        }finally{RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(read);}
    }
    static void Selection(Output output){
        PlayerSettings.colorSpace=ColorSpace.Gamma;
        var root=new GameObject("SourcePassSelection");var go=new GameObject("Quad");go.transform.parent=root.transform;
        var mesh=Quad(Color.white);go.AddComponent<MeshFilter>().sharedMesh=mesh;var renderer=go.AddComponent<MeshRenderer>();
        var cameraGo=new GameObject("Camera");cameraGo.transform.parent=root.transform;cameraGo.transform.position=new Vector3(0,0,-5);
        var camera=cameraGo.AddComponent<Camera>();camera.enabled=false;camera.orthographic=true;camera.orthographicSize=1;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=Color.green;
        var target=new RenderTexture(1,1,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear);target.Create();camera.targetTexture=target;
        var asset=ScriptableObject.CreateInstance<ProbePipelineAsset>();var previous=GraphicsSettings.renderPipelineAsset;GraphicsSettings.renderPipelineAsset=asset;
        var forward=new Material(Shader.Find("Hidden/NatsumeSourceParticle"));forward.SetColor("_BaseColor",Color.red);
        var depth=new Material(Shader.Find("Hidden/NatsumeSourceDepth"));
        try{
            ProbePipeline.Pass="SRPDefaultUnlit";renderer.sharedMaterial=forward;camera.Render();output.forwardPixel=Read(target);
            renderer.sharedMaterial=depth;camera.Render();output.depthOnlyForwardPixel=Read(target);
            ProbePipeline.Pass="DepthOnly";camera.Render();output.depthOnlyExplicitPixel=Read(target);
            foreach(string key in new[]{"ForwardLit","SRPDefaultUnlit","Always","ALWAYS","DepthOnly","depthonly"}){
                ProbePipeline.Pass="SRPDefaultUnlit";renderer.sharedMaterial=forward;forward.SetShaderPassEnabled(key,false);camera.Render();output.passEnable.Add(new PassEnable{program="forward",key=key,pixel=Read(target)});forward.SetShaderPassEnabled(key,true);
                ProbePipeline.Pass="DepthOnly";renderer.sharedMaterial=depth;depth.SetShaderPassEnabled(key,false);camera.Render();output.passEnable.Add(new PassEnable{program="depth",key=key,pixel=Read(target)});depth.SetShaderPassEnabled(key,true);
            }
            if(!ProbePipeline.Called)throw new Exception("Native SRP selection probe did not execute");
        }finally{GraphicsSettings.renderPipelineAsset=previous;UnityEngine.Object.DestroyImmediate(asset);UnityEngine.Object.DestroyImmediate(forward);UnityEngine.Object.DestroyImmediate(depth);UnityEngine.Object.DestroyImmediate(mesh);UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(root);}
    }
    class ProbePipelineAsset:RenderPipelineAsset {protected override RenderPipeline CreatePipeline(){return new ProbePipeline();}}
    class ProbePipeline:RenderPipeline {
        public static string Pass="SRPDefaultUnlit";public static bool Called;
        protected override void Render(ScriptableRenderContext context,Camera[] cameras){
            Called=true;
            foreach(var camera in cameras){
                ScriptableCullingParameters parameters;if(!camera.TryGetCullingParameters(out parameters))throw new Exception("Cannot cull source Pass probe");
                var culled=context.Cull(ref parameters);context.SetupCameraProperties(camera);
                var commands=new CommandBuffer();commands.SetRenderTarget(camera.targetTexture);commands.ClearRenderTarget(true,true,Color.green);context.ExecuteCommandBuffer(commands);commands.Release();
                var sorting=new SortingSettings(camera){criteria=SortingCriteria.CommonOpaque};var drawing=new DrawingSettings(new ShaderTagId(Pass),sorting);var filter=new FilteringSettings(RenderQueueRange.all);
                context.DrawRenderers(culled,ref drawing,ref filter);context.Submit();
            }
        }
    }
}
