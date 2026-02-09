# Asset License Notes

## Landmark imports (Poly Pizza)

### Tower — Quaternius
- Source page: https://poly.pizza/m/iuMDwgTRMU
- Downloaded file: `public/assets/poly-pizza/tower-quaternius.glb`
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/

### Windmill — Poly by Google
- Source page: https://poly.pizza/m/ctIRaIM3zXu
- Downloaded file: `public/assets/poly-pizza/windmill-poly-google.glb`
- License: **Creative Commons Attribution 3.0 (CC BY 3.0)**
- License URL: https://creativecommons.org/licenses/by/3.0/
- Required attribution text:
  - "Windmill" by Poly by Google via Poly Pizza (https://poly.pizza/m/ctIRaIM3zXu), licensed under CC BY 3.0.

## Deferred candidate (not imported)

### Modular Ruins Pack — Quaternius
- Source page: https://poly.pizza/m/F2LAK03B0r
- Direct model URL (from page metadata): https://static.poly.pizza/fa6cf69d-a091-4eb7-b62e-56290d8b9097.glb
- License: **Public Domain (CC0 1.0)**
- License URL: https://creativecommons.org/publicdomain/zero/1.0/
- Payload audit (2026-02-09):
  - Candidate GLB size: **7,965,364 bytes raw** (~7.6 MiB)
  - Candidate GLB gzip estimate: **2,701,915 bytes** (~2.58 MiB)
  - Current imported landmark payload baseline (tower + windmill): **299,400 bytes gzip**
- Decision: Over budget for current milestone target (~300 KB gzip). Do **not** import full pack; if needed, follow-up must selectively extract only 1-2 ruin pieces into a much smaller derived GLB and re-measure before merge.
