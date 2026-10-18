import * as THREE from "three";
import { buildCafe } from "./room";

const W = 640;
const H = 360;

export function start3d(stage: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  stage.appendChild(canvas);

  const camera = new THREE.PerspectiveCamera(54, W / H, 0.1, 40);
  camera.position.set(0.1, 1.7, 3.1);
  camera.lookAt(0.05, 1.0, -1.6);

  const cafe = buildCafe();

  const target = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });

  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: target.texture } },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      varying vec2 vUv;

      float bayer2(vec2 a) {
        a = floor(a);
        return fract(a.x / 2.0 + a.y * a.y * 0.75);
      }
      float bayer4(vec2 a) {
        return bayer2(0.5 * a) * 0.25 + bayer2(a);
      }
      float bayer8(vec2 a) {
        return bayer4(0.5 * a) * 0.25 + bayer2(a);
      }

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        // gentle shoulder so the lamp cores roll off instead of clipping
        c = vec3(1.0) - exp(-c * 1.62);
        c = pow(c, vec3(1.0 / 2.2));
        c *= vec3(1.06, 1.0, 0.91);
        float d = distance(vUv, vec2(0.5, 0.54));
        c *= 1.0 - smoothstep(0.36, 0.86, d) * 0.62;
        float b = bayer8(gl_FragCoord.xy);
        c = floor(c * 26.0 + b) / 26.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

  function resize(): void {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = `${Math.floor(W * scale)}px`;
    canvas.style.height = `${Math.floor(H * scale)}px`;
  }
  window.addEventListener("resize", resize);
  resize();

  const start = performance.now();
  renderer.setAnimationLoop(() => {
    const t = (performance.now() - start) / 1000;
    cafe.update(t);
    renderer.setRenderTarget(target);
    renderer.render(cafe.scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
  });
}
