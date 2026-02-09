# Art Direction Pass 01 (v1)

## Visual direction summary
Target mood: **soft dusk exploration** — calm but mysterious, with readable silhouettes and slightly ancient/fantasy props.

- Palette: cool blue-violet atmosphere + muted moss greens + warm stone accents
- Prop style: low-poly/stylized primitives first, then swap to optimized external assets
- Lighting intent: warm key light against cool fog for depth and character readability

## First-pass priorities
1. Establish mood baseline in-runtime (fog/light/terrain palette).
2. Add simple environmental set dressing clusters (ruin stump + rock) to break flatness.
3. Prepare external asset candidates with clear licenses.

## Candidate assets (lightweight + clear license)
1. **Kenney Nature Kit**
   - URL: https://kenney.nl/assets/nature-kit
   - License: Creative Commons **CC0** (page states "License Creative Commons CC0")
   - Fit: quick trees/rocks/foliage placeholders with low-poly style.

2. **Poly Haven 3D assets**
   - URL: https://polyhaven.com/
   - License: **CC0** (license page states all assets are CC0/public-domain equivalent)
   - Fit: high-quality rocks/ground details where we need visual focal points.

3. **ambientCG models/materials**
   - URL: https://ambientcg.com/license
   - License: **CC0 1.0 Universal**
   - Fit: supplemental terrain/prop materials while preserving commercial-use safety.

## Risks / constraints
- Keep scene draw calls low; prefer mesh reuse/instancing when replacing primitive props.
- Large PBR textures can exceed performance budget on low-end devices.
- Maintain style coherence if mixing very realistic assets (Poly Haven/ambientCG) with stylized character assets.
