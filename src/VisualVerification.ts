import { createPrefilteredEnvironment } from "zhuda-laya-engine";
declare const Laya: any;
/** Real GPU readback checks the public WebGL face order against Laya's upload order. */
export function verifyEnvironmentUpload(lod = 0) {
  const l = Laya,
    colors = [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [1, 1, 0, 1],
      [1, 0, 1, 1],
      [0, 1, 1, 1],
    ],
    light = createPrefilteredEnvironment(
      {
        size: 2,
        levels: [
          { size: 2, offset: 0, elements: 96 },
          { size: 1, offset: 96, elements: 24 },
        ],
        ambientSH: Array(27).fill(0),
      },
      new Float32Array([
        ...colors.flatMap((c) => [...c, ...c, ...c, ...c]),
        ...Array.from({ length: 6 }, () => [0, 0, 0, 1]).flat(),
      ]),
    );
  const name = "ZhudaIBLFaceReadback";
  if (!l.Shader3D.find(name)) {
    const shader = l.Shader3D.add(name);
    shader.shaderType = l.ShaderFeatureType.PostProcess;
    const sub = new l.SubShader(
      {
        a_PositionTexcoord: [
          l.VertexMesh.MESH_POSITION0,
          l.ShaderDataType.Vector4,
        ],
      },
      {
        u_Cube: l.ShaderDataType.TextureCube,
        u_ProbeLod: l.ShaderDataType.Float,
      },
      {},
    );
    shader.addSubShader(sub);
    const pass = sub.addShaderPass(
      "varying vec2 v_UV;void main(){gl_Position=vec4(a_PositionTexcoord.xy,0.,1.);v_UV=a_PositionTexcoord.zw;}",
      "varying vec2 v_UV;void main(){float i=floor(v_UV.x*6.);vec3 d=i<1.?vec3(1,0,0):i<2.?vec3(-1,0,0):i<3.?vec3(0,1,0):i<4.?vec3(0,-1,0):i<5.?vec3(0,0,1):vec3(0,0,-1);gl_FragColor=textureCubeLodEXT(u_Cube,d,u_ProbeLod);}",
    );
    pass.renderState.depthTest = l.RenderState.DEPTHTEST_ALWAYS;
    pass.renderState.depthWrite = false;
    pass.renderState.cull = l.RenderState.CULL_NONE;
    pass.statefirst = true;
  }
  const material = new l.Material();
  material.setShaderName(name);
  material.setTexture("u_Cube", light.texture);
  material.setFloat("u_ProbeLod", lod);
  const target = new l.RenderTexture(
      6,
      1,
      l.RenderTargetFormat.R8G8B8A8,
      l.RenderTargetFormat.None,
      false,
      1,
    ),
    command = new l.CommandBuffer();
  try {
    command.blitScreenQuad(
      l.Texture2D.whiteTexture,
      target,
      null,
      l.Shader3D.find(name),
      material.shaderData,
      0,
    );
    command.context = l.RenderContext3D._instance;
    command._applyOne();
    const bytes = new Uint8Array(24);
    target.getData(0, 0, 6, 1, bytes);
    return {
      actual: [...bytes],
      expected: colors
        .flat()
        .map((n, i) => n * 255 * (i % 4 === 3 ? 1 : 1 - lod)),
    };
  } finally {
    command.clear();
    material.setTexture("u_Cube", null);
    material.destroy();
    target.destroy();
    light.dispose();
  }
}
