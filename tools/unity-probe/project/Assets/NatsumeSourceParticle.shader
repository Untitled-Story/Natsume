// ShaderLab translation of the retained Metal program, not recovered ShaderLab source.
Shader "Hidden/NatsumeSourceParticle" {
    Properties {
        _BaseMap ("Base Map", 2D) = "white" {}
        _BaseColor ("Base Color", Color) = (1,1,1,1)
        _Surface ("Surface", Float) = 1
        _Cull ("Cull", Float) = 0
        _SrcBlend ("Source", Float) = 1
        _DstBlend ("Destination", Float) = 0
        _SrcBlendAlpha ("Alpha source", Float) = 1
        _DstBlendAlpha ("Alpha destination", Float) = 0
        _BlendOp ("Blend operation", Float) = 0
        _ZWrite ("Depth write", Float) = 0
    }
    SubShader {
        Pass {
            Name "ForwardLit"
            Cull [_Cull] ZWrite [_ZWrite] ZTest LEqual
            Blend [_SrcBlend] [_DstBlend], [_SrcBlendAlpha] [_DstBlendAlpha]
            BlendOp [_BlendOp]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            sampler2D _BaseMap; float _GlobalMipBias; half4 _BaseColor; half _Surface;
            struct Input {float4 position:POSITION; float2 uv:TEXCOORD0; half4 color:COLOR;};
            struct Varying {float4 position:SV_POSITION; float2 uv:TEXCOORD0; half4 color:COLOR;};
            Varying vert(Input v){Varying o;o.position=UnityObjectToClipPos(v.position);o.uv=v.uv;o.color=v.color;return o;}
            half4 frag(Varying i):SV_Target {half4 c=tex2Dbias(_BaseMap,float4(i.uv,0,_GlobalMipBias))*_BaseColor*i.color;return half4(c.rgb,_Surface==half(1)?c.a:half(1));}
            ENDCG
        }
        Pass {
            Name "DepthOnly" Tags {"LightMode"="DepthOnly"}
            Cull [_Cull] ZWrite On ZTest LEqual ColorMask R
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float4 vert(float4 p:POSITION):SV_POSITION {return UnityObjectToClipPos(p);}
            half4 frag(float4 p:SV_POSITION):SV_Target {return half4(p.z,0,0,0);}
            ENDCG
        }
    }
}
