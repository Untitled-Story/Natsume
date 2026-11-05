// GPU readback of individual builtin mip levels; no material color or blending.
Shader "Hidden/NatsumeSourceMip" {
    Properties { _BaseMap ("Image",2D)="white"{} _Mip ("Mip",Float)=0 }
    SubShader { Pass {
        Cull Off ZWrite Off ZTest Always Blend One Zero
        CGPROGRAM
        #pragma vertex vert
        #pragma fragment frag
        #include "UnityCG.cginc"
        sampler2D _BaseMap;float _Mip;
        struct Input {float4 position:POSITION;float2 uv:TEXCOORD0;};
        struct Varying {float4 position:SV_POSITION;float2 uv:TEXCOORD0;};
        Varying vert(Input v){Varying o;o.position=UnityObjectToClipPos(v.position);o.uv=v.uv;return o;}
        float4 frag(Varying i):SV_Target{return tex2Dlod(_BaseMap,float4(i.uv,0,_Mip));}
        ENDCG
    } }
}
