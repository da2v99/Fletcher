// Waves made by the ship itself: near-field bow/stern waves plus a true Kelvin wake pattern.
// Shared by the vertex displacement and the per-pixel normals.
const SHIPWAVE_GLSL = `
    uniform vec2 uShipXZ;
    uniform vec2 uShipFwd;
    uniform float uSpeed;

    // Waterline half-breadth of the hull
    float hullHalfWL(float z) {
        if (z > 55.0 || z < -57.0) return -1.0;
        float p = 1.0;
        if (z > 5.0) { float u = clamp((z - 5.0) / 52.35, 0.0, 1.0); p = 1.0 - pow(u, 2.2); }
        else if (z < -20.0) {
            float u = clamp((-20.0 - z) / 37.35, 0.0, 1.0);
            p = u < 0.88 ? 1.0 - 0.3 * pow(u / 0.88, 2.0) : 0.7 * sqrt(max(0.0, 1.0 - pow((u - 0.88) / 0.12, 2.0)));
        }
        return 6.05 * p * mix(1.0, 0.7, smoothstep(8.0, 54.0, z));
    }

    // Height of the ship's own waves at undisplaced point p; sp = sampling footprint for anti-aliasing
    float shipWaves(vec2 p, float sp) {
        float U = uSpeed;
        if (U < 0.5) return 0.0;
        vec2 rel = p - uShipXZ;
        if (dot(rel, rel) > 1.6e6) return 0.0;
        float along = dot(rel, uShipFwd);
        float ac = abs(dot(rel, vec2(-uShipFwd.y, uShipFwd.x)));
        float Fr2 = U * U / 9.81;                      // U^2 / g
        float amp = clamp(Fr2 * 0.05, 0.0, 2.2);       // ~1.8 m bow wave at flank

        // Near field: bow wave hump, midships trough, stern wave, hugging the hull
        float hb = max(hullHalfWL(clamp(along, -56.9, 54.9)), 0.0);
        float off = max(ac - hb, 0.0);
        float side = exp(-off * off / (30.0 + 0.4 * Fr2));
        float h = amp * exp(-pow((along - 47.0) / 8.0, 2.0)) * side;
        h -= amp * 0.45 * exp(-pow((along + 5.0) / 28.0, 2.0)) * side;
        h += amp * 0.6 * exp(-pow((along + 64.0) / 10.0, 2.0)) * exp(-off * off / 60.0);

        // Far field: Kelvin pattern radiating from the bow.
        // Crest lines x = P cos(t)(1 + sin^2 t), y = P cos^2(t) sin(t); both branches solved in closed form.
        float x = 52.0 - along;
        if (x > 1.0) {
            float rho = ac / x;
            float wedge = 1.0 - smoothstep(0.32, 0.37, rho);
            if (wedge > 0.0) {
                float r2 = min(rho * rho, 0.125);
                float disc = sqrt(max(1.0 - 8.0 * r2, 0.0));
                float sT = ((1.0 - 2.0 * r2) - disc) / (2.0 * (r2 + 1.0));   // transverse branch (sin^2)
                float sD = ((1.0 - 2.0 * r2) + disc) / (2.0 * (r2 + 1.0));   // diverging branch
                float PT = x / (sqrt(1.0 - sT) * (1.0 + sT));
                float PD = x / (sqrt(max(1.0 - sD, 1e-3)) * (1.0 + sD));
                float k0 = 1.0 / Fr2;
                float decay = sqrt(40.0 / (x + 40.0)) * exp(-x / 900.0);
                float cusp = 1.0 + 1.2 * exp(-pow((0.3536 - rho) / 0.03, 2.0));   // tall crests on the 19.47 deg line
                float lT = 6.2831853 * Fr2 * (1.0 - sT);   // local wavelengths, for anti-aliasing
                float lD = 6.2831853 * Fr2 * (1.0 - sD);
                float fT = smoothstep(3.0 * sp, 7.0 * sp, lT);
                float fD = smoothstep(3.0 * sp, 7.0 * sp, lD);
                h += amp * 0.5 * decay * wedge * cusp * (0.6 * fT * cos(k0 * PT) + fD * cos(k0 * PD + 0.8));
            }
        }
        return h;
    }
`;
