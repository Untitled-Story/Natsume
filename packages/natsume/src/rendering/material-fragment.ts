export const materialFragment = `#version 300 es
in vec2 vUV;
in vec4 vColor;
in float vCustom;
in float vDepth;
in vec2 vScreenUV;
in vec2 vUIPosition;
in vec3 vCanvasPosition;
uniform vec4 uCanvasRect;
uniform float uCanvasClip;
uniform sampler2D uTexture;
uniform float uLinear;
uniform float uTextureSRGB;
uniform float uVertexSRGB;
uniform float uModel;
uniform vec4 uTint;
uniform vec4 uFog;
uniform vec3 uFogColor;
uniform float uSoft;
uniform float uMipBias;
uniform float uInvFade;
uniform float uUIAlphaClip;
uniform float uMaskCutoff;
uniform float uUIClip;
uniform vec4 uUIRect;
uniform vec2 uUISoftness;
uniform vec4 uTextureSampleAdd;
uniform sampler2D uSceneDepth;
uniform vec4 uDepthUV;
out vec4 finalColor;
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
void main(){
  if(uCanvasClip>0.5){vec2 pos=vCanvasPosition.xy/vCanvasPosition.z;if(any(lessThan(pos,uCanvasRect.xy))||any(greaterThan(pos,uCanvasRect.zw)))discard;}
  vec4 texel=texture(uTexture,vUV,uMipBias);
  if(uMaskCutoff>=0.0 && texel.a<uMaskCutoff)discard;
  vec4 color=vColor;
  if(uLinear>0.5){if(uTextureSRGB>0.5)texel.rgb=toLinear(texel.rgb);if(uVertexSRGB>0.5)color.rgb=toLinear(color.rgb);}
  bool ui=uModel>4.5 && uModel<5.5;
  if(ui){color.a=floor(color.a*255.0+0.5)/255.0;texel+=uTextureSampleAdd;}
  vec4 c=texel*color;
  if(uModel>3.5){
    if(uModel<5.5){vec4 tint=uTint;if(uLinear>0.5)tint.rgb=toLinear(tint.rgb);c*=tint;}
    if(ui && uUIClip>0.5){
      vec2 distance=min(vUIPosition-uUIRect.xy,uUIRect.zw-vUIPosition);
      vec2 pixel=max(fwidth(vUIPosition),vec2(0.000001));
      vec2 factor=clamp(distance/(uUISoftness*0.5+pixel),vec2(0.0),vec2(1.0));
      c.a*=factor.x*factor.y;
    }
    if(ui && uUIAlphaClip>0.5 && c.a<0.001)discard;
    finalColor=uModel<5.5?vec4(c.rgb*c.a,c.a):c;
  }else if(uModel>0.5){
    vec4 tint=uTint;
    if(uLinear>0.5)tint.rgb=toLinear(tint.rgb);
    c*=tint;
    if(uModel>1.5){
      if(uSoft>0.5)c.a*=clamp(uInvFade*(texture(uSceneDepth,vScreenUV*uDepthUV.xy+uDepthUV.zw).r-vDepth),0.0,1.0);
      c*=2.0;c.a=clamp(c.a,0.0,1.0);
      float f=1.0;
      if(uFog.x>0.5&&uFog.x<1.5)f=clamp((uFog.z-vDepth)/(uFog.z-uFog.y),0.0,1.0);
      else if(uFog.x>1.5&&uFog.x<2.5)f=exp(-uFog.w*vDepth);
      else if(uFog.x>2.5)f=exp(-pow(uFog.w*vDepth,2.0));
      c.rgb=mix(uModel<2.5?vec3(0.0):uFogColor,c.rgb,f);
    }
    finalColor=c;
  }else finalColor=vec4(c.rgb*c.a,vCustom<=0.5?c.a:0.0);
}`;
