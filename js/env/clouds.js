// Volumetric sky: the raymarched "protean" clouds from Waves and Clouds/clouds.js, lit by our sun and
// thickened by the storm. They are rendered into a cube map one face at a time, which the sky dome displays
// and the ocean samples for its reflections, so both always match.
// Quality (Settings.gfx.clouds): 0 a painted cloud layer, 1-3 raymarched with more steps and resolution.
// Lighter levels also refresh the cube more slowly and never render all six faces in one frame, which is
// what trips phone GPU watchdogs.
const CLOUD_Q = [
    { size: 128, steps: 0, every: 8 },
    { size: 192, steps: 40, every: 2 },
    { size: 320, steps: 72, every: 1 },
    { size: 448, steps: 110, every: 1 }
];

const Clouds = (() => {
    let q = Settings.gfx.clouds, SIZE = CLOUD_Q[q].size;
    let rt, cubeCam, skyScene, skyMesh, face = 0, dirtyFaces = 6, frame = 0, domeMat = null;

    const cloudU = Object.assign({}, WEATHER_U, { uFlash: { value: 0 }, uCover: { value: 0.6 } });   // flashes are added live, not baked

    const fragment = () => `#define STEPS ${CLOUD_Q[q].steps}
` + NOISE_GLSL + SKY_GLSL + `
        varying vec3 vDir;
        uniform float uCover;
        #define PHI 1.61803398875
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

        float cloudMap(vec3 p) {
            float y = p.y;
            p.xz *= 0.25;
            p.y *= 0.15;
            float wind = mix(0.02, 0.07, uStorm);
            p.z += uTime * wind;
            p.x += uTime * wind * 0.4;
            float d = 0.0, amp = 1.0;
            for (int i = 0; i < 5; i++) {
                p.xy *= rot(PHI + float(i));
                p.yz *= rot(PHI * 0.5);
                float n = dot(sin(p), cos(p.yzx));
                d += i == 0 ? n * amp : (abs(n) - 1.2) * amp * 0.4;
                amp *= 0.618;
                p *= 1.618;
            }
            d += uCover;                                      // coverage grows with the storm
            d -= abs(y - 7.0) * mix(0.2, 0.13, uStorm);       // and the cloud deck thickens
            return max(0.0, d);
        }

        void main() {
            vec3 rd = normalize(vDir);
            vec3 sky = skyColor(rd);
            if (rd.y < -0.02) { gl_FragColor = vec4(sky, 0.0); return; }
#if STEPS == 0
            // Painted cloud layer: fbm on a plane overhead, thicker with the storm
            vec2 uv = rd.xz / max(rd.y, 0.04) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
            float n = fbm3(uv) * 0.65 + fbm3(uv * 2.7 + 3.1) * 0.35;
            float cov = smoothstep(0.62 - uCover * 0.22, 0.95 - uCover * 0.2, n) * smoothstep(0.0, 0.12, rd.y);
            float dawn0 = 1.0 - smoothstep(0.05, 0.45, uSunDir.y);
            float bright0 = mix(0.45, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.85 * nightF());
            vec3 cc = mix(vec3(1.0, 0.98, 0.95), uSunCol * vec3(1.0, 0.86, 0.8), dawn0 * 0.7) * bright0 * (1.0 - 0.45 * uStorm);
            float gold0 = goldenF() * (1.0 - uStorm * 0.6);
            cc = mix(cc, vec3(1.0, 0.55, 0.32) * bright0 * 1.2, gold0 * 0.7);
            cc = mix(cc, mix(mix(vec3(0.24, 0.29, 0.38), vec3(0.34, 0.27, 0.44), gold0), vec3(0.10, 0.11, 0.13), uStorm) * bright0, smoothstep(0.7, 1.0, n));
            float haze0 = (1.0 - smoothstep(0.0, 0.3, rd.y)) * 0.65 + (1.0 - smoothstep(0.0, 0.05, rd.y)) * 0.35;
            cc = mix(cc, sky, haze0);
            gl_FragColor = vec4(mix(sky, cc, cov * 0.9), cov);
#else

            float dawn = 1.0 - smoothstep(0.05, 0.45, uSunDir.y);
            float bright = mix(0.45, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.85 * nightF());
            float sd = max(dot(rd, uSunDir), 0.0);
            vec3 sunL = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.05), uSunDir.z));
            vec3 litCol = mix(vec3(1.0, 0.99, 0.97), uSunCol * vec3(1.0, 0.86, 0.8), dawn * 0.7) * bright * (1.0 - 0.45 * uStorm);
            litCol += uSunCol * pow(sd, 6.0) * 0.4 * (1.0 - uStorm * 0.6);   // silver lining toward the sun
            // Sunrise and sunset: tops lit orange and gold, undersides violet-grey
            float gold = goldenF() * (1.0 - uStorm * 0.6);
            litCol = mix(litCol, vec3(1.0, 0.56, 0.30) * bright * 1.25 + uSunCol * pow(sd, 3.0) * 0.5, gold * 0.75);
            vec3 shadowCol = mix(mix(vec3(0.24, 0.29, 0.38), vec3(0.36, 0.27, 0.45), gold * 0.8), vec3(0.10, 0.11, 0.13), uStorm) * bright;

            vec3 ro = vec3(0.0, -1.0, 0.0);
            vec4 rez = vec4(0.0);
            float t = 1.0 + fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 0.5;
            float stride = 110.0 / float(STEPS);
            for (int i = 0; i < STEPS; i++) {
                if (rez.a > 0.99 || t > 70.0) break;
                vec3 pos = ro + t * rd;
                float m = cloudMap(pos);
                if (m > 0.01) {
                    float den = smoothstep(0.0, 1.0, m);
                    float dif = clamp((den - cloudMap(pos + sunL * 0.4)) / 0.8, 0.0, 1.0);
                    vec3 c = mix(shadowCol, litCol, clamp(dif * 1.5 + 0.1, 0.0, 1.0));
                    vec4 col = vec4(c, min(1.0, 0.08 * stride) * den * smoothstep(70.0, 35.0, t));
                    col.rgb *= col.a;
                    rez += col * (1.0 - rez.a);
                }
                t += (0.05 + t * 0.025) * stride;
            }
            // Aerial perspective: low clouds dissolve into the horizon haze
            float haze = (1.0 - smoothstep(0.0, 0.3, rd.y)) * 0.65 + (1.0 - smoothstep(0.0, 0.05, rd.y)) * 0.35;
            rez.rgb = mix(rez.rgb, sky * rez.a, haze);
            gl_FragColor = vec4(sky * (1.0 - rez.a) + rez.rgb, rez.a);
#endif
        }
    `;

    const makeMaterial = () => new THREE.ShaderMaterial({
        uniforms: cloudU,
        vertexShader: `
            varying vec3 vDir;
            void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: fragment(),
        side: THREE.BackSide, depthWrite: false, depthTest: false
    });

    function init() {
        rt = new THREE.WebGLCubeRenderTarget(SIZE, {
            format: THREE.RGBAFormat, generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter
        });
        skyScene = new THREE.Scene();
        cubeCam = new THREE.CubeCamera(1, 100, rt);
        skyScene.add(cubeCam);
        skyMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), makeMaterial());
        skyScene.add(skyMesh);
        cubeCam.updateMatrixWorld(true);
        return rt.texture;
    }

    // Change quality: new shader and cube resolution (the texture object is kept, so materials sampling
    // it don't need rebuilding)
    function setQuality(nq) {
        if (nq === q || !rt) return;
        q = nq;
        skyMesh.material.dispose();
        skyMesh.material = makeMaterial();
        if (CLOUD_Q[q].size !== SIZE) {
            SIZE = CLOUD_Q[q].size;
            rt.setSize(SIZE, SIZE);
            if (domeMat) domeMat.uniforms.uTexelAng.value = Math.PI / 2 / SIZE;
        }
        dirtyFaces = 6;
    }

    // Render cube faces round-robin: a few per frame after the weather changes, then one every few frames
    function update(renderer, force) {
        frame++;
        const cfg = CLOUD_Q[q];
        let n = 0;
        if (force) n = 6;
        else if (dirtyFaces > 0) n = q >= 2 ? Math.min(dirtyFaces, 3) : 1;
        else if (frame % cfg.every === 0) n = 1;
        if (!n) return;
        const cams = cubeCam.children;
        const prev = renderer.getRenderTarget();
        for (let i = 0; i < n; i++) {
            rt.texture.generateMipmaps = face === 5;
            renderer.setRenderTarget(rt, face);
            renderer.render(skyScene, cams[face]);
            face = (face + 1) % 6;
            if (dirtyFaces > 0) dirtyFaces--;
        }
        rt.texture.generateMipmaps = true;
        renderer.setRenderTarget(prev);
    }

    function invalidate() {
        cloudU.uCover.value = lerp(0.1, 1.9, weather.storm);   // fair-weather cumulus -> solid storm deck
        dirtyFaces = 6;
    }

    // The visible sky: the cube map, plus the sun disc (hidden by cloud) and live lightning flashes
    function createSkyDome(cubeTex) {
        const mat = new THREE.ShaderMaterial({
            uniforms: Object.assign({ uSkyCube: { value: cubeTex }, uTexelAng: { value: Math.PI / 2 / SIZE } }, WEATHER_U),
            vertexShader: `
                varying vec3 vDir;
                void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: `
                uniform samplerCube uSkyCube;
                uniform vec3 uSunDir;
                uniform vec3 uSunCol;
                uniform float uStorm;
                uniform float uFlash;
                uniform float uTexelAng;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    // The cube is a few hundred texels a face and the view magnifies it: a small rotated tent
                    // filter hides its texels and the raymarch's dither, so cloud edges stay soft, not blocky
                    vec3 ta = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
                    vec3 tb = cross(d, ta);
                    float r = uTexelAng * 0.85;
                    vec4 s = textureCube(uSkyCube, d) * 0.28
                        + textureCube(uSkyCube, normalize(d + (ta * 0.95 + tb * 0.31) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (-ta * 0.31 + tb * 0.95) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (-ta * 0.95 - tb * 0.31) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (ta * 0.31 - tb * 0.95) * r)) * 0.18;
                    float sd = dot(d, uSunDir);
                    vec3 col = s.rgb + uSunCol * smoothstep(0.9994, 0.9997, sd) * 4.0 * (1.0 - uStorm * 0.95) * (1.0 - s.a) * step(0.0, d.y);
                    col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(0.0, 0.3, d.y)) * (0.5 + s.a);
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide, depthWrite: false, fog: false
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), mat);
        dome.frustumCulled = false;
        dome.renderOrder = -1;
        domeMat = mat;
        return dome;
    }

    return { init, update, invalidate, setQuality, createSkyDome, uniforms: cloudU, get texture() { return rt.texture; } };
})();
