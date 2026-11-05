// ShaderLab translation of the sole retained Lit Pass; no forward color Pass.
Shader "Hidden/NatsumeSourceDepth" {
    Properties {_Cull ("Cull",Float)=0}
    SubShader {
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
