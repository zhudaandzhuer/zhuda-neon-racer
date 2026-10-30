# Third-party notices

Neon Apex uses [zhuda-laya-engine](https://github.com/zhudaandzhuer/zhuda-laya-engine), pinned to `74b04064208f8afe624896482d7bc438dd15dc29` (MIT; copyright 2026 豬大 / zhudaandzhuer).

The bundled LayaAir 3.4.2 core, d3, WebGL 2D/3D, glTF and post-process runtime files are from [Layabox / LayaAir](https://github.com/layabox/LayaAir), distributed under MIT. No Spine runtime, remote music or fonts are loaded. Tracks, procedural scenery, effects and sounds are authored in this separate game project.

The silver/black S800 GLBs derive from the user's AI reconstruction using four generated reference images and Hunyuan 3D V3.1. This repository contains reduced game assets and conversion metadata; the original high-poly file is preserved outside the repository. Vehicle names/design/trademarks retain their respective owners' rights. See [model provenance](public/models/README.md). The three garage choices tune the same chassis.

The separate HARBOR visual study uses CC0 HDRs/textures from [Poly Haven](https://polyhaven.com/license): `kloppenheim_06_puresky`, `aerial_asphalt_01`, and `concrete_wall_006`. Exact source URLs, byte sizes and SHA-256 hashes are in [visual-assets/sources.json](public/visual-assets/sources.json). GGX/SH lighting and metallic/smoothness maps are derived by the included preparation script. The study uses its own 320K-triangle/4K S800 variant. Its hard-surface tower, barrier and dock warehouse were authored for this project after review of generated concepts; inventories and source records are in [scenery.json](public/visual-assets/scenery.json). These assets remain in the game repository.

The launch image combines the user-provided 豬大 character with the official LayaAir 3 logo from https://layaair.com/3.x/doc/_astro/layaair3-logo.DHjbuK9G.png. The master was generated with gpt-image-2.5-flare through remote-imagegen; the exact official logo was composited onto the generated plaque. Source artwork and provenance are preserved in https://github.com/zhudaandzhuer/zhuda-arcade/tree/main/source-assets. The project code is MIT; character and brand artwork retain their respective owners’ rights.

## zhuda-laya-engine

MIT License

Copyright (c) 2026 豬大 (zhudaandzhuer) — https://github.com/zhudaandzhuer/zhuda-laya-engine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## LayaAir

MIT License

Copyright (c) 2022 layabox

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
# Authored driving S800

The HARBOR free-drive model is a separate authored reference reconstruction of the Maextro S800, with 15 standard PBR materials and independent wheel nodes. Its source, reference provenance, exact SHA-256 and limitations are in `source-assets/maextro_s800_hero_v2/`. It is not an official manufacturer CAD asset. The original textured vehicle remains in presentation views.
