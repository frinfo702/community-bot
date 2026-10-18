import * as THREE from "three";
import {
  C,
  branchTexture,
  gardenTexture,
  glowTexture,
  lanternTexture,
  norenTexture,
  scrollTexture,
  shojiTexture,
  streakTexture,
  tatamiTexture,
  toTexture,
  woodTexture,
  bitmap,
  rect,
} from "./art";
import { createCharacter } from "./character";

export interface CafeScene {
  scene: THREE.Scene;
  update: (t: number) => void;
}

interface Waver {
  update: (t: number) => void;
}

function tiled(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function lam(color: number, map?: THREE.Texture, flat = false): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...(map ? { map } : {}), flatShading: flat });
}

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function panel(
  w: number,
  h: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  ry = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  return mesh;
}

/** Plane whose vertices are pushed by wind; anchored at its top edge. */
function cloth(
  w: number,
  h: number,
  material: THREE.Material,
  amp: number,
  speed: number,
  phase: number,
): { mesh: THREE.Mesh; waver: Waver } {
  const geo = new THREE.PlaneGeometry(w, h, 10, 8);
  const base = Array.from(geo.attributes.position.array as Float32Array);
  const mesh = new THREE.Mesh(geo, material);
  const waver: Waver = {
    update(t: number) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3]!;
        const y = base[i * 3 + 1]!;
        const drop = (h / 2 - y) / h;
        const wobble =
          Math.sin(t * speed + x * 1.6 + phase) * 0.7 +
          Math.sin(t * speed * 1.9 + x * 3.3 + phase * 2) * 0.3;
        pos.setZ(i, wobble * amp * drop);
        pos.setX(i, x + Math.sin(t * speed * 0.7 + y * 2.2 + phase) * amp * 0.25 * drop);
      }
      pos.needsUpdate = true;
    },
  };
  return { mesh, waver };
}

export function buildCafe(): CafeScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a0f0a, 0.03);
  const wavers: Waver[] = [];
  const flickers: Array<{ light: THREE.PointLight; base: number; phase: number }> = [];

  const wood = woodTexture(1);
  const woodPlanks = woodTexture(2, true);
  const woodFine = woodTexture(9);
  const tatami = tatamiTexture();
  const shoji = shojiTexture();
  const glow = glowTexture();

  const mWood = lam(0xffffff, tiled(wood, 1, 1));
  const mWoodDark = lam(0x7a5642, tiled(woodFine, 1, 1));
  const mWoodLight = lam(0xc7a17c, tiled(woodFine, 1, 1));
  const mFloor = lam(0xffffff, tiled(woodPlanks, 5, 5));
  const mTatami = lam(0xffffff, tiled(tatami, 2.2, 2.2));
  const mShoji = new THREE.MeshBasicMaterial({
    map: tiled(shoji, 4, 3),
    color: 0xd8a878,
    toneMapped: false,
  });
  const mWall = lam(0x5a3a26, tiled(wood, 3, 1));
  const mCeil = lam(0x5a3a26, tiled(wood, 6, 6));

  // ---- shell -------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0.3);
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 7.2), mCeil);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 2.78, -0.4);
  scene.add(ceiling);

  // back wall: shoji on the left, open garden on the right
  scene.add(panel(4.5, 2.25, mShoji, -1.55, 1.32, -3.5));
  for (const x of [-3.78, -2.66, -1.55, -0.43, 0.68]) {
    scene.add(box(0.08, 2.3, 0.06, mWoodDark, x, 1.4, -3.48));
  }
  scene.add(box(4.6, 0.1, 0.08, mWoodDark, -1.55, 2.46, -3.48));
  scene.add(box(4.6, 0.1, 0.08, mWoodDark, -1.55, 0.22, -3.48));
  scene.add(box(4.6, 0.07, 0.07, mWoodDark, -1.55, 1.08, -3.46));

  // scroll and a plant stand break up the shoji wall
  scene.add(box(0.44, 0.72, 0.4, mWood, -0.85, 0.36, -2.95));
  flowers(-0.85, 0.72, -2.95, 0x6d7f8a, 1.05, 0x7a8fc0);
  const scroll2 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.56),
    new THREE.MeshBasicMaterial({ map: scrollTexture(), toneMapped: false }),
  );
  scroll2.position.set(-0.35, 1.62, -3.42);
  scene.add(scroll2);

  // opening frame + transom
  scene.add(box(0.12, 2.2, 0.1, mWoodDark, 0.86, 1.25, -3.47));
  scene.add(box(0.12, 2.2, 0.1, mWoodDark, 3.6, 1.25, -3.47));
  scene.add(box(2.9, 0.12, 0.12, mWoodDark, 2.23, 2.32, -3.46));
  scene.add(box(2.9, 0.1, 0.1, mWoodDark, 2.23, 0.2, -3.46));
  for (let i = 0; i < 11; i++) {
    scene.add(box(0.03, 0.3, 0.05, mWoodDark, 1.02 + i * 0.24, 2.5, -3.44));
  }

  // left and right walls
  const leftWall = panel(7, 2.8, mWall, -3.95, 1.4, -0.4, Math.PI / 2);
  scene.add(leftWall);
  const rightWall = panel(7, 2.8, mWall, 3.95, 1.4, -0.4, -Math.PI / 2);
  scene.add(rightWall);

  // ceiling beams
  for (const z of [-2.7, -1.2, 0.35, 1.9]) {
    scene.add(box(8.4, 0.16, 0.12, mWoodDark, 0, 2.7, z));
  }
  scene.add(box(0.16, 0.22, 7, mWoodDark, 0, 2.6, -0.4));

  // door posts in the foreground
  scene.add(box(0.16, 2.8, 0.16, mWoodDark, -3.82, 1.4, 1.35));
  scene.add(box(0.16, 2.8, 0.16, mWoodDark, 3.82, 1.4, 1.35));
  scene.add(box(7.9, 0.18, 0.16, mWoodDark, 0, 2.62, 1.35));

  // ---- counter with the sweets case --------------------------------------
  const counterRoot = new THREE.Group();
  counterRoot.position.set(-0.12, 0, -0.5);
  scene.add(counterRoot);
  const counter = new THREE.Group();
  counter.add(box(2.85, 1.0, 0.95, mWood, -2.42, 0.5, 0.55));
  counter.add(box(3.0, 0.09, 1.05, mWoodLight, -2.42, 1.045, 0.55));
  for (let x = -3.75; x < -1.1; x += 0.17) {
    counter.add(box(0.04, 0.82, 0.03, mWoodDark, x, 0.52, 1.035));
  }
  counter.add(box(2.9, 0.12, 0.06, mWoodDark, -2.42, 0.13, 1.04));
  counter.add(box(2.9, 0.06, 0.06, mWoodDark, -2.42, 0.93, 1.04));
  counterRoot.add(counter);

  const caseGroup = new THREE.Group();
  caseGroup.position.set(-2.1, 1.09, 0.28);
  caseGroup.rotation.y = 0.14;
  const caseBack = new THREE.MeshBasicMaterial({ color: 0x8a4a26, toneMapped: false });
  caseGroup.add(box(1.8, 0.62, 0.04, caseBack, 0, 0.33, -0.3));
  caseGroup.add(box(1.8, 0.06, 0.62, mWoodLight, 0, 0.03, 0));
  caseGroup.add(box(1.76, 0.03, 0.56, mWoodLight, 0, 0.25, 0));
  caseGroup.add(box(1.76, 0.03, 0.56, mWoodLight, 0, 0.45, 0));
  for (const x of [-0.88, 0.88]) {
    for (const z of [-0.3, 0.3]) caseGroup.add(box(0.05, 0.64, 0.05, mWood, x, 0.33, z));
  }
  caseGroup.add(box(1.88, 0.06, 0.7, mWood, 0, 0.65, 0));
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.78, 0.56),
    new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  glass.position.set(0, 0.34, 0.36);
  caseGroup.add(glass);
  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.56),
    new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  glint.position.set(-0.45, 0.34, 0.365);
  glint.rotation.z = 0.22;
  caseGroup.add(glint);

  const sweets = [0xf0b6c4, 0xdc8fa6, 0xe9dcc0, 0x9fb27a, 0xd9a86a, 0xc9d6b0];
  for (const [si, y] of [0.09, 0.3, 0.5].entries()) {
    for (let i = 0; i < 8; i++) {
      for (const z of [-0.1, 0.09]) {
        const sweet = new THREE.Mesh(
          new THREE.CylinderGeometry(0.042, 0.048, 0.04, 7),
          lam(sweets[(i + si + (z > 0 ? 2 : 0)) % sweets.length]!),
        );
        sweet.position.set(-0.76 + i * 0.21, y + 0.035, z);
        caseGroup.add(sweet);
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.054, 0.054, 0.008, 8),
          lam(0xe9dfc9),
        );
        plate.position.set(-0.76 + i * 0.21, y + 0.006, z);
        caseGroup.add(plate);
      }
    }
  }
  const caseLight = new THREE.PointLight(0xffcf96, 3, 2.4, 2);
  caseLight.position.set(-2.55, 1.62, 0.3);
  counterRoot.add(caseGroup);
  counterRoot.add(caseLight);

  // tag on the case
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.2),
    new THREE.MeshBasicMaterial({ map: toTexture(priceTag()), toneMapped: false }),
  );
  tag.position.set(-2.0, 1.3, 1.0);
  counterRoot.add(tag);

  // small price tags pinned along the counter front
  for (let i = 0; i < 3; i++) {
    const paperTag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.075, 0.145),
      new THREE.MeshBasicMaterial({ map: toTexture(priceTag()), toneMapped: false }),
    );
    paperTag.position.set(-3.42 + i * 0.2, 0.72, 1.045);
    counterRoot.add(paperTag);
  }

  // ---- shelf behind the counter ------------------------------------------
  const shelf = new THREE.Group();
  shelf.position.set(-2.95, 0, -2.85);
  shelf.add(box(0.06, 2.35, 0.55, mWoodDark, -0.9, 1.17, 0));
  shelf.add(box(0.06, 2.35, 0.55, mWoodDark, 0.9, 1.17, 0));
  shelf.add(box(1.86, 0.06, 0.55, mWood, 0, 2.33, 0));
  for (const y of [0.35, 0.9, 1.4, 1.9]) {
    shelf.add(box(1.8, 0.05, 0.55, mWoodLight, 0, y, 0));
  }
  const jarColors = [0x2f2a2a, 0x6f6656, 0xd9cbb2, 0x3d4a52, 0x8d5a3c, 0xb9a98c];
  for (const [row, y] of [0.42, 0.97, 1.47, 1.97].entries()) {
    for (let i = 0; i < 5; i++) {
      const r = 0.055 + ((i + row) % 3) * 0.014;
      const h = 0.14 + ((i * 7 + row) % 4) * 0.045;
      const jar = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.86, r, h, 7),
        lam(jarColors[(i + row * 2) % jarColors.length]!, undefined, true),
      );
      jar.position.set(-0.72 + i * 0.36, y + h / 2 + 0.03, -0.02);
      shelf.add(jar);
      if (i % 2 === 0) {
        shelf.add(box(r * 2.1, 0.02, r * 2.1, mWoodDark, -0.72 + i * 0.36, y + h + 0.04, -0.02));
      }
    }
  }
  scene.add(shelf);

  // left wall shelf with crates and boxes
  const sideShelf = new THREE.Group();
  sideShelf.position.set(-3.78, 0, -0.9);
  for (const z of [-1.2, 0.2]) {
    sideShelf.add(box(0.5, 0.05, 1.5, mWoodLight, 0, 1.1, z));
    sideShelf.add(box(0.5, 0.05, 1.5, mWoodLight, 0, 1.65, z));
  }
  const crateColors = [0x6b4327, 0x8a5a36, 0x4b2c1b, 0xc9b28c];
  for (let i = 0; i < 6; i++) {
    const w = 0.28 + (i % 2) * 0.1;
    sideShelf.add(
      box(0.42, 0.2, w, lam(crateColors[i % crateColors.length]!), 0, 1.23 + (i % 2) * 0.55, -1.1 + i * 0.42),
    );
  }
  scene.add(sideShelf);

  // ---- raised tatami platform -------------------------------------------
  scene.add(box(3.35, 0.18, 3.05, mWoodDark, 1.92, 0.09, -1.85));
  scene.add(box(3.3, 0.04, 3.0, mTatami, 1.92, 0.19, -1.85));
  scene.add(box(3.35, 0.08, 0.1, mWoodLight, 1.92, 0.2, -0.34));
  scene.add(box(0.1, 0.08, 3.05, mWoodLight, 0.27, 0.2, -1.85));
  scene.add(box(0.9, 0.09, 1.0, mWood, 2.6, 0.045, 0.35));

  // low table
  const table = new THREE.Group();
  table.position.set(1.6, 0.21, -1.72);
  table.add(box(1.72, 0.07, 0.8, mWoodDark, 0, 0.33, 0));
  table.add(box(1.66, 0.015, 0.74, mWoodLight, 0, 0.368, 0));
  for (const x of [-0.76, 0.76]) {
    for (const z of [-0.31, 0.31]) {
      table.add(box(0.07, 0.32, 0.07, mWoodDark, x, 0.16, z));
    }
  }
  scene.add(table);

  // tea set on the table
  const teapot = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 8, 6),
    lam(0x3b3531, undefined, true),
  );
  teapot.scale.set(1, 0.78, 1);
  teapot.position.set(1.32, 0.455, -1.85);
  scene.add(teapot);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.1, 5), lam(0x3b3531));
  spout.rotation.z = 1.1;
  spout.position.set(1.22, 0.465, -1.85);
  scene.add(spout);

  for (const [x, z] of [
    [1.78, -1.7],
    [2.0, -1.86],
  ]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.05, 7), lam(0xe4d8be));
    cup.position.set(x, 0.425, z);
    scene.add(cup);
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.03, 7), lam(0x7d8f52));
    tea.rotation.x = -Math.PI / 2;
    tea.position.set(x, 0.451, z);
    scene.add(tea);
  }
  const sweetPlate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.16), lam(0xcbb08a));
  sweetPlate.position.set(1.95, 0.39, -1.55);
  scene.add(sweetPlate);
  const sweet = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.03, 6), lam(0xecb7c1));
  sweet.position.set(1.95, 0.41, -1.55);
  scene.add(sweet);

  // cushions
  for (const [x, z, rot] of [
    [0.85, -1.55, 0.12],
    [2.35, -1.5, -0.2],
  ] as const) {
    const cushion = box(0.5, 0.08, 0.46, lam(0x2e3a5c), x, 0.25, z);
    cushion.rotation.y = rot;
    scene.add(cushion);
    const knot = box(0.1, 0.03, 0.1, lam(0x8892ac), x, 0.3, z);
    scene.add(knot);
  }

  // cabinet and lucky cat beside her
  scene.add(box(0.5, 0.5, 0.34, mWood, 0.5, 0.44, -2.9));
  const cat = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 6), lam(0xf1e8d6, undefined, true));
  cat.scale.set(1, 1.1, 0.9);
  cat.position.set(0.5, 0.76, -2.9);
  scene.add(cat);
  const catEarL = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.05, 4), lam(0xf1e8d6));
  catEarL.position.set(0.47, 0.84, -2.9);
  scene.add(catEarL);
  const catEarR = catEarL.clone();
  catEarR.position.x = 0.53;
  scene.add(catEarR);

  // scroll on the post
  const scroll = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.62),
    new THREE.MeshBasicMaterial({ map: scrollTexture(), toneMapped: false }),
  );
  scroll.position.set(0.86, 1.55, -3.42);
  scene.add(scroll);

  // ---- guest ------------------------------------------------------------
  const character = createCharacter();
  character.mesh.scale.set(1.5, 1.4, 1);
  character.mesh.position.set(1.62, 1.1875, -2.0);
  scene.add(character.mesh);
  wavers.push({ update: character.update });

  const seatShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  seatShadow.rotation.x = -Math.PI / 2;
  seatShadow.scale.y = 0.5;
  seatShadow.position.set(1.66, 0.205, -1.8);
  scene.add(seatShadow);

  // ---- hanging cloth and lanterns ---------------------------------------
  const mNoren = new THREE.MeshBasicMaterial({
    map: norenTexture(4),
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.3,
    toneMapped: false,
  });
  const norenA = cloth(1.6, 0.8, mNoren, 0.07, 1.1, 0.4);
  norenA.mesh.position.set(-1.95, 2.26, -0.75);
  scene.add(norenA.mesh);
  scene.add(box(1.8, 0.04, 0.05, mWoodDark, -1.95, 2.67, -0.75));
  wavers.push(norenA.waver);

  const norenB = cloth(1.5, 0.62, mNoren, 0.05, 1.3, 1.7);
  norenB.mesh.position.set(-3.05, 2.34, 0.35);
  norenB.mesh.rotation.y = 0.32;
  scene.add(norenB.mesh);
  scene.add(box(1.6, 0.04, 0.05, mWoodDark, -3.05, 2.66, 0.35));
  wavers.push(norenB.waver);

  const furin = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xa9d8d2, transparent: true, opacity: 0.75, toneMapped: false }),
  );
  furin.scale.set(1, 0.85, 1);
  furin.position.set(-1.55, 2.32, 0.55);
  scene.add(furin);
  scene.add(box(0.01, 0.3, 0.01, mWoodDark, -1.55, 2.5, 0.55));
  const furinTag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xf0e4c8, side: THREE.DoubleSide, toneMapped: false }),
  );
  furinTag.position.set(-1.55, 2.18, 0.56);
  scene.add(furinTag);

  const glowSprite = (x: number, y: number, z: number, size: number, mat?: THREE.MeshBasicMaterial) => {
    const m =
      mat ??
      new THREE.MeshBasicMaterial({
        map: glow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    s.position.set(x, y, z);
    scene.add(s);
    return s;
  };

  function hangLantern(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    lightIntensity: number,
    phase: number,
  ): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const cord = box(0.012, 0.3, 0.012, mWoodDark, 0, -0.15, 0);
    pivot.add(cord);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({ map: lanternTexture(3), toneMapped: false }),
    );
    body.scale.set(1, height / (radius * 2), 1);
    body.position.y = -0.3 - height / 2;
    pivot.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.035, 8), mWoodDark);
    cap.position.y = -0.3 - height - 0.01;
    pivot.add(cap);
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 4.2, radius * 4.2),
      new THREE.MeshBasicMaterial({
        map: glow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.position.y = -0.3 - height / 2;
    pivot.add(halo);
    const light = new THREE.PointLight(0xffbd7a, lightIntensity, 7, 2);
    light.position.y = -0.3 - height / 2;
    pivot.add(light);
    flickers.push({ light, base: lightIntensity, phase });
    scene.add(pivot);
    wavers.push({
      update(t: number) {
        pivot.rotation.z = Math.sin(t * 0.62 + phase) * 0.045;
        pivot.rotation.x = Math.sin(t * 0.47 + phase * 1.7) * 0.03;
        const h = halo.material as THREE.MeshBasicMaterial;
        h.opacity = 0.4 + Math.sin(t * 9.3 + phase) * 0.06 + Math.sin(t * 21.7 + phase) * 0.03;
      },
    });
  }

  hangLantern(-0.55, 2.45, -1.5, 0.22, 0.56, 18, 0.3);

  // small andon on the counter, left end
  const counterLamp = new THREE.Group();
  counterLamp.position.set(-3.48, 1.09, 0.35);
  counterLamp.add(box(0.26, 0.02, 0.26, mWoodDark, 0, 0.01, 0));
  for (const [x, z] of [
    [-0.11, -0.11],
    [0.11, -0.11],
    [-0.11, 0.11],
    [0.11, 0.11],
  ] as const) {
    counterLamp.add(box(0.02, 0.34, 0.02, mWoodDark, x, 0.18, z));
  }
  const clPaper = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.3, 0.22),
    new THREE.MeshBasicMaterial({ map: lanternTexture(6), toneMapped: false }),
  );
  clPaper.position.y = 0.18;
  counterLamp.add(clPaper);
  counterLamp.add(box(0.28, 0.025, 0.28, mWoodDark, 0, 0.35, 0));
  counterRoot.add(counterLamp);

  // wagashi tray on the counter edge
  const wagashiTray = box(0.42, 0.03, 0.3, mWoodDark, -1.32, 1.11, 0.9);
  counterRoot.add(wagashiTray);
  const wagashiColors = [0xecb3c2, 0xd98fa8, 0xeee0c4, 0x9fb27a, 0xd9a86a];
  for (let i = 0; i < 5; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.04, 6), lam(wagashiColors[i]!));
    w.position.set(-1.46 + i * 0.08, 1.145, 0.9 + (i % 2) * 0.06);
    counterRoot.add(w);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.02), lam(0x5d7a44));
    leaf.rotation.x = -Math.PI / 2;
    leaf.position.set(-1.46 + i * 0.08, 1.168, 0.9 + (i % 2) * 0.06);
    counterRoot.add(leaf);
  }

  // tall andon by the window
  const andon = new THREE.Group();
  andon.position.set(2.88, 0, -1.15);
  for (const [x, z] of [
    [-0.16, -0.16],
    [0.16, -0.16],
    [-0.16, 0.16],
    [0.16, 0.16],
  ] as const) {
    andon.add(box(0.045, 1.0, 0.045, mWoodDark, x, 0.5, z));
  }
  const andonPaper = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.82, 0.28),
    new THREE.MeshBasicMaterial({ map: lanternTexture(8), toneMapped: false }),
  );
  andonPaper.position.y = 0.54;
  andon.add(andonPaper);
  andon.add(box(0.42, 0.05, 0.42, mWoodDark, 0, 1.02, 0));
  andon.add(box(0.36, 0.04, 0.36, mWoodDark, 0, 0.06, 0));
  const andonHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.0),
    new THREE.MeshBasicMaterial({
      map: glow,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  andonHalo.position.y = 0.6;
  andon.add(andonHalo);
  const andonLight = new THREE.PointLight(0xffb370, 20, 8, 2);
  andonLight.position.set(0, 0.62, 0);
  andon.add(andonLight);
  flickers.push({ light: andonLight, base: 20, phase: 1.4 });
  scene.add(andon);

  // a small paper lamp behind the guest
  const guestLamp = new THREE.Group();
  guestLamp.position.set(2.72, 0.2, -2.7);
  guestLamp.add(box(0.2, 0.03, 0.2, mWoodDark, 0, 0.02, 0));
  guestLamp.add(box(0.2, 0.03, 0.2, mWoodDark, 0, 0.5, 0));
  const guestPaper = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.44, 0.17),
    new THREE.MeshBasicMaterial({ map: lanternTexture(15), toneMapped: false }),
  );
  guestPaper.position.y = 0.26;
  guestLamp.add(guestPaper);
  for (const [x, z] of [
    [-0.1, -0.1],
    [0.1, -0.1],
    [-0.1, 0.1],
    [0.1, 0.1],
  ] as const) {
    guestLamp.add(box(0.02, 0.5, 0.02, mWoodDark, x, 0.26, z));
  }
  const guestLight = new THREE.PointLight(0xffb978, 5, 4, 2);
  guestLight.position.y = 0.28;
  guestLamp.add(guestLight);
  flickers.push({ light: guestLight, base: 5, phase: 3.2 });
  scene.add(guestLamp);

  // foreground andon, bottom left of the frame
  const frontLamp = new THREE.Group();
  frontLamp.position.set(-1.45, 0, 0.75);
  for (const [x, z] of [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ] as const) {
    frontLamp.add(box(0.05, 1.1, 0.05, mWoodDark, x, 0.55, z));
  }
  const frontPaper = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.92, 0.32),
    new THREE.MeshBasicMaterial({ map: lanternTexture(12), toneMapped: false }),
  );
  frontPaper.position.y = 0.6;
  frontLamp.add(frontPaper);
  frontLamp.add(box(0.48, 0.06, 0.48, mWoodDark, 0, 1.12, 0));
  frontLamp.add(box(0.4, 0.05, 0.4, mWoodDark, 0, 0.07, 0));
  const frontHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 1.35),
    new THREE.MeshBasicMaterial({
      map: glow,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  frontHalo.position.y = 0.64;
  frontLamp.add(frontHalo);
  const frontLight = new THREE.PointLight(0xffb06a, 12, 7, 2);
  frontLight.position.set(0, 0.68, 0);
  frontLamp.add(frontLight);
  flickers.push({ light: frontLight, base: 12, phase: 2.6 });
  scene.add(frontLamp);

  // ---- greenery ---------------------------------------------------------
  function flowers(x: number, y: number, z: number, pot: number, scale: number, tone: number): void {
    const vase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09 * scale, 0.065 * scale, 0.16 * scale, 8),
      lam(pot, undefined, true),
    );
    vase.position.set(x, y + 0.08 * scale, z);
    scene.add(vase);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.3 * scale, 4), lam(C.leaf));
    stem.position.set(x, y + 0.28 * scale, z);
    scene.add(stem);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.022 * scale, 5, 4), lam(i % 3 === 0 ? 0xf2ead8 : tone, undefined, true));
      bloom.position.set(
        x + Math.cos(a) * 0.06 * scale,
        y + (0.34 + (i % 3) * 0.03) * scale,
        z + Math.sin(a) * 0.06 * scale,
      );
      scene.add(bloom);
    }
  }

  flowers(-3.0, 0.6, 1.0, 0x6d7f8a, 1.55, 0x6c7fb4);
  flowers(-3.15, 1.02, -2.2, 0x8d6a4c, 1.1, 0x7a8fc0);
  flowers(3.3, 0.62, 0.62, 0x7d8a78, 1.35, 0x6b7fb2);
  flowers(2.95, 0.2, -2.55, 0x9b7a58, 0.9, 0xd8a3b6);

  // standing flower table at the right
  scene.add(box(0.5, 0.62, 0.5, mWood, 3.32, 0.31, 0.62));

  // a scroll and a shelf keep the right wall from going empty
  const sideScroll = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.9),
    new THREE.MeshBasicMaterial({ map: scrollTexture(), toneMapped: false }),
  );
  sideScroll.position.set(3.9, 1.5, -1.4);
  sideScroll.rotation.y = -Math.PI / 2;
  scene.add(sideScroll);
  scene.add(box(0.26, 0.04, 0.5, mWoodLight, 3.82, 1.16, -2.3));
  const sideVase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.045, 0.12, 7),
    lam(0x7d8a78, undefined, true),
  );
  sideVase.position.set(3.8, 1.24, -2.38);
  scene.add(sideVase);
  for (let i = 0; i < 5; i++) {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), lam(0x6b7fb2, undefined, true));
    bloom.position.set(3.8 + (i % 2) * 0.05, 1.36 + (i % 3) * 0.05, -2.38 + (i % 2) * 0.05);
    scene.add(bloom);
  }

  // ---- garden through the opening ---------------------------------------
  const garden = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 5),
    new THREE.MeshBasicMaterial({ map: gardenTexture(), toneMapped: false }),
  );
  garden.position.set(2.3, 2.2, -5.3);
  scene.add(garden);

  scene.add(box(2.9, 0.18, 1.5, mWood, 2.3, 0.09, -4.2));
  const rail = lam(0xa8433a);
  scene.add(box(2.9, 0.06, 0.06, rail, 2.3, 0.52, -4.6));
  for (const x of [1.0, 2.0, 3.0, 3.6]) {
    scene.add(box(0.06, 0.52, 0.06, rail, x, 0.26, -4.6));
  }

  const mBranch = new THREE.MeshLambertMaterial({
    map: branchTexture(13),
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
  });
  const outsideA = cloth(2.8, 1.95, mBranch, 0.06, 0.8, 0.2);
  outsideA.mesh.position.set(1.45, 1.95, -4.35);
  scene.add(outsideA.mesh);
  wavers.push(outsideA.waver);
  const outsideB = cloth(2.1, 1.5, mBranch, 0.05, 0.95, 2.3);
  outsideB.mesh.position.set(3.35, 1.9, -4.3);
  scene.add(outsideB.mesh);
  wavers.push(outsideB.waver);

  // a small torii and stone lantern give the garden depth
  const torii = new THREE.Group();
  torii.position.set(3.45, 0.18, -5.0);
  torii.scale.setScalar(0.78);
  torii.add(box(0.08, 1.5, 0.08, lam(0xb0403a), -0.42, 0.75, 0));
  torii.add(box(0.08, 1.5, 0.08, lam(0xb0403a), 0.42, 0.75, 0));
  torii.add(box(1.2, 0.09, 0.1, lam(0x8f2f2c), 0, 1.55, 0));
  torii.add(box(1.0, 0.07, 0.08, lam(0xc04a3e), 0, 1.3, 0));
  scene.add(torii);

  const stone = new THREE.Group();
  stone.position.set(1.45, 0.18, -4.7);
  stone.scale.setScalar(0.75);
  stone.add(box(0.22, 0.08, 0.22, lam(0x8d8a7c), 0, 0.04, 0));
  stone.add(box(0.08, 0.34, 0.08, lam(0x8d8a7c), 0, 0.25, 0));
  stone.add(box(0.26, 0.14, 0.24, lam(0xa09c8c), 0, 0.48, 0));
  stone.add(box(0.18, 0.1, 0.16, new THREE.MeshBasicMaterial({ color: 0xffcf8a }), 0, 0.48, 0));
  scene.add(stone);

  // branch hanging into the room, upper left
  const insideBranch = cloth(2.8, 2.0, mBranch, 0.035, 0.7, 1.1);
  insideBranch.mesh.position.set(-2.5, 2.12, 0.6);
  insideBranch.mesh.rotation.z = -0.16;
  scene.add(insideBranch.mesh);
  wavers.push(insideBranch.waver);

  // ---- foreground table -------------------------------------------------
  const frontTable = new THREE.Group();
  frontTable.position.set(-0.3, 0.74, 1.8);
  frontTable.add(box(2.0, 0.08, 0.9, mWoodDark, 0, 0, 0));
  frontTable.add(box(1.94, 0.015, 0.84, mWoodLight, 0, 0.045, 0));
  for (const x of [-0.9, 0.9]) {
    for (const z of [-0.36, 0.36]) {
      frontTable.add(box(0.09, 0.56, 0.09, mWoodDark, x, -0.3, z));
    }
  }
  scene.add(frontTable);

  // tray with matcha and a sweet
  frontTable.add(box(0.62, 0.02, 0.42, mWoodDark, -0.32, 0.06, -0.08));
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.11, 9), lam(0xe6ddc8));
  bowl.position.set(-0.38, 0.12, -0.1);
  frontTable.add(bowl);
  const matcha = new THREE.Mesh(new THREE.CircleGeometry(0.11, 9), lam(0x6f8b46));
  matcha.rotation.x = -Math.PI / 2;
  matcha.position.set(-0.38, 0.176, -0.1);
  frontTable.add(matcha);
  const frontSweet = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.04, 7), lam(0xf0bcc6));
  frontSweet.position.set(-0.08, 0.08, 0.08);
  frontTable.add(frontSweet);

  // white fox statue
  const foxBody = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.16, 6), lam(0xf6efe2, undefined, true));
  foxBody.position.set(-0.8, 0.12, 0.12);
  frontTable.add(foxBody);
  const foxHead = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), lam(0xf6efe2, undefined, true));
  foxHead.position.set(-0.8, 0.21, 0.12);
  frontTable.add(foxHead);
  for (const dx of [-0.03, 0.03]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 4), lam(0xf6efe2));
    ear.position.set(-0.8 + dx, 0.26, 0.12);
    frontTable.add(ear);
  }
  const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.05), new THREE.MeshBasicMaterial({ color: 0xb23a32 }));
  bib.position.set(-0.8, 0.17, 0.08);
  frontTable.add(bib);

  // a candle lights the foreground tray
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.1, 7), lam(0xf0e0c0));
  candle.position.set(0.82, 0.11, 0.02);
  frontTable.add(candle);
  const flame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 0.055),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false }),
  );
  flame.position.set(0.82, 0.19, 0.02);
  frontTable.add(flame);
  const candleLight = new THREE.PointLight(0xffb870, 2.2, 2.2, 2);
  candleLight.position.set(0.82, 0.22, 0.02);
  frontTable.add(candleLight);
  flickers.push({ light: candleLight, base: 2.2, phase: 4.1 });

  flowers(-1.15, 0.74, 1.95, 0x6d7f8a, 0.9, 0x6b7fb2);

  // ---- floor reflections -------------------------------------------------
  const streak = streakTexture();
  const reflections: Array<[number, number, number, number]> = [
    [2.88, -0.2, 0.5, 2.8],
    [-2.55, 1.2, 1.1, 3.0],
    [-2.35, 1.9, 0.45, 2.2],
  ];
  for (const [x, z, w, d] of reflections) {
    const r = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        map: streak,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, 0.012, z);
    scene.add(r);
  }

  // ---- particles ---------------------------------------------------------
  const petals: Array<{ mesh: THREE.Mesh; x: number; y: number; z: number; phase: number; speed: number }> = [];
  const petalGeo = new THREE.PlaneGeometry(0.035, 0.025);
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xf9d2dc : 0xeea8bc,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(petalGeo, mat);
    const petal = {
      mesh,
      x: -3.4 + Math.random() * 7,
      y: 0.6 + Math.random() * 2.0,
      z: -3.2 + Math.random() * 5,
      phase: Math.random() * 10,
      speed: 0.12 + Math.random() * 0.16,
    };
    petals.push(petal);
    scene.add(mesh);
  }

  const dust: Array<{ mesh: THREE.Mesh; x: number; y: number; z: number; phase: number }> = [];
  for (let i = 0; i < 30; i++) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.014, 0.014),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    dust.push({
      mesh,
      x: -3 + Math.random() * 6,
      y: 0.4 + Math.random() * 1.9,
      z: -2.8 + Math.random() * 4.4,
      phase: Math.random() * 10,
    });
    scene.add(mesh);
  }

  const steam: Array<{ mesh: THREE.Mesh; phase: number }> = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 0.08),
      new THREE.MeshBasicMaterial({
        color: 0xffe6c4,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    steam.push({ mesh, phase: i / 4 });
    scene.add(mesh);
  }

  // ---- lights ------------------------------------------------------------
  scene.add(new THREE.AmbientLight(0xffd2a0, 1.18));
  const fill = new THREE.PointLight(0xffcf9a, 11, 12, 2);
  fill.position.set(0.4, 2.1, 2.4);
  scene.add(fill);
  const gardenLight = new THREE.PointLight(0xffa596, 13, 9, 2);
  gardenLight.position.set(2.6, 1.8, -3.1);
  scene.add(gardenLight);
  flickers.push({ light: gardenLight, base: 13, phase: 0.7 });

  // shader-driven flicker of every lamp
  function flicker(t: number): void {
    for (const f of flickers) {
      const n =
        0.9 +
        Math.sin(t * 11.3 + f.phase) * 0.055 +
        Math.sin(t * 23.7 + f.phase * 2.1) * 0.035 +
        Math.sin(t * 5.1 + f.phase * 0.7) * 0.04;
      f.light.intensity = f.base * n;
    }
  }

  function update(t: number): void {
    flicker(t);
    for (const w of wavers) w.update(t);
    for (const p of petals) {
      const fall = (t * p.speed + p.phase) % 3.4;
      p.mesh.position.set(
        p.x + Math.sin(t * 0.7 + p.phase) * 0.28,
        Math.max(0.06, p.y - fall),
        p.z + Math.cos(t * 0.5 + p.phase) * 0.12,
      );
      p.mesh.rotation.z = t * 0.8 + p.phase;
    }
    for (const d of dust) {
      d.mesh.position.set(
        d.x + Math.sin(t * 0.11 + d.phase) * 0.2,
        d.y + Math.sin(t * 0.17 + d.phase * 1.3) * 0.12,
        d.z,
      );
    }
    for (const s of steam) {
      const k = (t * 0.28 + s.phase) % 1;
      s.mesh.position.set(1.32 + Math.sin(k * 6 + s.phase) * 0.05, 0.52 + k * 0.42, -1.85);
      s.mesh.scale.setScalar(0.7 + k * 1.6);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - k);
      s.mesh.quaternion.copy(cameraQuat);
    }
  }

  // billboards face the camera; the camera is static, so one quaternion is enough
  const cameraQuat = new THREE.Quaternion();

  return {
    scene,
    update: (t: number) => {
      cameraQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      update(t);
    },
  };
}

function priceTag(): HTMLCanvasElement {
  const { c, ctx } = bitmap(16, 32);
  rect(ctx, 0, 0, 16, 32, "#e8dcc0");
  rect(ctx, 0, 0, 16, 1, "#7a5535");
  rect(ctx, 0, 31, 16, 1, "#7a5535");
  for (let i = 0; i < 4; i++) rect(ctx, 4, 7 + i * 5, 8, 1, "#5a4432");
  return c;
}
