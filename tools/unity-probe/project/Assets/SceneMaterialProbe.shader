Shader "Hidden/Natsume/SceneMaterialProbe" {
 Properties { _MainTex("Texture",2D)="white"{} _Color("Color",Color)=(1,1,1,1) _Src("Src",Int)=1 _Dst("Dst",Int)=10 _SrcA("SrcA",Int)=1 _DstA("DstA",Int)=10 _Op("Op",Int)=0 _OpA("OpA",Int)=0 _ZTest("ZTest",Int)=4 _ZWrite("ZWrite",Int)=0 _Cull("Cull",Int)=0 _Mask("Mask",Int)=15 _StencilComp("Comp",Int)=8 _StencilRef("Ref",Int)=0 _StencilPass("Pass",Int)=0 _StencilFail("Fail",Int)=0 _StencilZFail("ZFail",Int)=0 _ReadMask("Read",Int)=255 _WriteMask("Write",Int)=255 _Premultiply("Premultiply",Float)=0 _Bias("Bias",Float)=0 }
 SubShader { Tags {"Queue"="Transparent"} Pass {
 Blend [_Src] [_Dst], [_SrcA] [_DstA]
 BlendOp [_Op], [_OpA]
 ZTest [_ZTest] ZWrite [_ZWrite] Cull [_Cull] ColorMask [_Mask]
 Stencil { Ref [_StencilRef] Comp [_StencilComp] Pass [_StencilPass] Fail [_StencilFail] ZFail [_StencilZFail] ReadMask [_ReadMask] WriteMask [_WriteMask] }
 CGPROGRAM
 #pragma vertex vert
 #pragma fragment frag
 #include "UnityCG.cginc"
 sampler2D _MainTex; float4 _MainTex_ST,_Color; float _Premultiply,_Bias;
 struct app {float4 vertex:POSITION;float4 color:COLOR;float2 uv:TEXCOORD0;};
 struct vary {float4 vertex:SV_POSITION;float4 color:COLOR;float2 uv:TEXCOORD0;};
 vary vert(app v){vary o;o.vertex=UnityObjectToClipPos(v.vertex);o.color=v.color*_Color;o.uv=TRANSFORM_TEX(v.uv,_MainTex);return o;}
 float4 frag(vary i):SV_Target {float4 c=tex2Dbias(_MainTex,float4(i.uv,0,_Bias))*i.color;if(_Premultiply>.5)c.rgb*=c.a;return c;}
 ENDCG
 }}
}
