// Car assets for the track scene.
//
// Two sources, one contract. Both return a THREE.Group with:
//   forward = +Z, wheels on the ground at y = 0, origin at the wheelbase centre
//   group.userData = { wheels: Object3D[] (spin about local X), paintMat, headMat, tailMat }
//
//  - buildProceduralGT3(): a stylised 992 GT3 RS built from extruded profiles. No files.
//  - loadCarModel(url):    a GLB (e.g. a CC-BY model from Sketchfab), normalised to the same contract.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// 992 GT3 RS, metres
const L = 4.57, W = 1.90, WHEELBASE = 2.457, TRACK = 1.62;

export function carMaterials(paint = 0x1d4fc4) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.06 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.42, metalness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e14, roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.3, metalness: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.7 }),
    head: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, emissive: 0xfff4dc, emissiveIntensity: 0, roughness: 0.2, metalness: 0.4 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0606, emissive: 0xff2a1e, emissiveIntensity: 0.8, roughness: 0.3 }),
  };
}

// Fit a plane to a mesh's vertices (world space): centre, two in-plane axes, normal, and half-extents.
// Power iteration on the covariance matrix — two dominant directions span the plane, their cross is the normal.
function planeFit(mesh) {
  const p = mesh.geometry.attributes.position, m = mesh.matrixWorld, n = p.count;
  const pts = new Float32Array(n * 3), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z; c.add(v); }
  c.multiplyScalar(1 / n);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3] - c.x, y = pts[i * 3 + 1] - c.y, z = pts[i * 3 + 2] - c.z;
    C[0] += x * x; C[1] += x * y; C[2] += x * z; C[4] += y * y; C[5] += y * z; C[8] += z * z;
  }
  C[3] = C[1]; C[6] = C[2]; C[7] = C[5];
  const mul = (M, u) => new THREE.Vector3(M[0] * u.x + M[1] * u.y + M[2] * u.z, M[3] * u.x + M[4] * u.y + M[5] * u.z, M[6] * u.x + M[7] * u.y + M[8] * u.z);
  const power = (M, seed) => { let u = seed.clone().normalize(); for (let k = 0; k < 40; k++) u = mul(M, u).normalize(); return u; };
  const e1 = power(C, new THREE.Vector3(0.71, 0.33, 0.62));
  const l1 = mul(C, e1).dot(e1);
  const D = C.slice();
  const ex = [e1.x, e1.y, e1.z];
  for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) D[r * 3 + s] -= l1 * ex[r] * ex[s];
  let e2 = power(D, new THREE.Vector3(-0.4, 0.8, 0.45));
  e2.sub(e1.clone().multiplyScalar(e2.dot(e1))).normalize();
  const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
  let a = 0, b = 0, t = 0;
  for (let i = 0; i < n; i++) { v.set(pts[i * 3] - c.x, pts[i * 3 + 1] - c.y, pts[i * 3 + 2] - c.z); a = Math.max(a, Math.abs(v.dot(e1))); b = Math.max(b, Math.abs(v.dot(e2))); t = Math.max(t, Math.abs(v.dot(normal))); }
  return { center: c, e1, e2, normal, halfW: a, halfH: b, halfT: t };
}

// Extrude a THREE.Shape drawn in the (z, y) side plane across the car's width (x), centred on x = 0.
function extrudeShape(shape, width, material, bevel = 0.08) {
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 16,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.rotation.y = -Math.PI / 2;        // shape x (car length) → world z
  mesh.position.x = width / 2 - bevel;   // centre the extrusion on x = 0
  mesh.castShadow = true;
  return mesh;
}

const v2 = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
const WHEEL_R = 0.36, ARCH_R = 0.47, SILL = 0.28;

// A side profile that runs over the top via a smooth spline, then back along the sill with
// semicircular notches over the wheel positions in `notches` (z coordinates).
function bodyShape(topPoints, notches, sill = SILL) {
  const sh = new THREE.Shape();
  const first = topPoints[0], last = topPoints[topPoints.length - 1];
  sh.moveTo(first[0], first[1]);
  sh.splineThru(v2(topPoints.slice(1)));
  sh.lineTo(last[0], sill);
  const sorted = [...notches].sort((a, b) => a - b); // rear (most negative) first — we walk rear → front
  for (const z of sorted) {
    sh.lineTo(z - ARCH_R, sill);
    sh.absarc(z, sill, ARCH_R, Math.PI, 0, true);
  }
  sh.lineTo(first[0], sill);
  sh.closePath();
  return sh;
}

function wheel(mats, radius, width, x, z) {
  const hub = new THREE.Group();
  hub.position.set(x, radius, z);
  const sgn = Math.sign(x);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 32), mats.rubber);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, width * 0.7, 28), mats.rim);
  rim.rotation.z = Math.PI / 2;
  rim.position.x = sgn * width * 0.16;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.5, 28), mats.trim);
  dish.rotation.z = Math.PI / 2;
  dish.position.x = sgn * width * 0.2;
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(width * 0.3, radius * 1.24, 0.04), mats.rim);
    s.position.x = sgn * width * 0.36;
    s.rotation.x = (i / 7) * Math.PI;
    hub.add(s);
  }
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xc8352a, roughness: 0.4 }));
  lock.rotation.z = Math.PI / 2;
  lock.position.x = sgn * width * 0.54;
  hub.add(tire, rim, dish, lock);
  return hub;
}

export function buildProceduralGT3(paint = 0x1d4fc4) {
  const mats = carMaterials(paint);
  const car = new THREE.Group();
  const zf = WHEELBASE / 2, zr = -WHEELBASE / 2;

  // main body: low bonnet between the fenders, shoulder line, engine deck, rear
  const body = bodyShape([
    [2.18, 0.30], [2.21, 0.46], [2.14, 0.60], [1.95, 0.68], [1.55, 0.72], [1.10, 0.75], [0.70, 0.80],
    [0.20, 0.86], [-0.40, 0.90], [-1.00, 0.92], [-1.50, 0.90], [-1.90, 0.85], [-2.10, 0.76], [-2.19, 0.60], [-2.20, 0.44], [-2.14, 0.32],
  ], [zr, zf]);
  car.add(extrudeShape(body, 1.62, mats.paint, 0.08));

  // front fenders: rise above the bonnet and run to the nose (911 "frog eye" line)
  const fenderF = bodyShape([
    [2.18, 0.30], [2.22, 0.50], [2.16, 0.68], [2.00, 0.78], [1.70, 0.82], [1.35, 0.82], [1.00, 0.78], [0.70, 0.70], [0.55, 0.55], [0.52, 0.32],
  ], [zf]);
  for (const sgn of [-1, 1]) { const m = extrudeShape(fenderF, 0.28, mats.paint, 0.05); m.position.x += sgn * 0.76; car.add(m); }

  // rear hips: the RS width, blending into the deck
  const fenderR = bodyShape([
    [-0.48, 0.32], [-0.55, 0.60], [-0.75, 0.80], [-1.05, 0.90], [-1.40, 0.92], [-1.75, 0.86], [-2.05, 0.74], [-2.18, 0.56], [-2.20, 0.34],
  ], [zr]);
  for (const sgn of [-1, 1]) { const m = extrudeShape(fenderR, 0.30, mats.paint, 0.05); m.position.x += sgn * 0.75; car.add(m); }

  // glasshouse: the flyline from the screen base over the roof to the tail
  const glass = new THREE.Shape();
  glass.moveTo(0.95, 0.84);
  glass.splineThru(v2([[0.70, 0.98], [0.40, 1.12], [0.10, 1.22], [-0.25, 1.26], [-0.60, 1.25], [-0.95, 1.18], [-1.30, 1.04], [-1.60, 0.90], [-1.72, 0.84]]));
  glass.lineTo(0.95, 0.84);
  glass.closePath();
  car.add(extrudeShape(glass, 1.40, mats.glass, 0.06));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.016, 0.8), mats.carbon);
  roof.position.set(0, 1.262, -0.2);
  car.add(roof);

  // underbody, splitter, diffuser
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 3.9), mats.trim);
  floor.position.set(0, 0.2, 0);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.025, 0.4), mats.carbon);
  splitter.position.set(0, 0.17, 2.06);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.5), mats.carbon);
  diffuser.position.set(0, 0.22, -1.98); diffuser.rotation.x = -0.28;
  car.add(floor, splitter, diffuser);

  // swan-neck rear wing
  const wingPlank = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.026, 0.3), mats.carbon);
  wingPlank.position.set(0, 1.3, -1.72); wingPlank.rotation.x = 0.14;
  for (const x of [-0.52, 0.52]) {
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.46, 0.3), mats.carbon);
    neck.position.set(x, 1.1, -1.56); neck.rotation.x = 0.5;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.24, 0.4), mats.carbon);
    plate.position.set(Math.sign(x) * 0.86, 1.3, -1.72);
    car.add(neck, plate);
  }
  car.add(wingPlank);
  const duck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.2), mats.carbon);
  duck.position.set(0, 0.9, -2.02); duck.rotation.x = -0.32;
  car.add(duck);

  // lights, exhausts, mirrors, intake
  for (const x of [-0.72, 0.72]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), mats.head);
    h.scale.set(1.05, 0.8, 0.7); h.position.set(x, 0.66, 2.1);
    car.add(h);
  }
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.045, 0.04), mats.tail);
  tailBar.position.set(0, 0.74, -2.2);
  car.add(tailBar);
  for (const x of [-0.26, 0.26]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.2, 14), mats.rim);
    ex.rotation.x = Math.PI / 2; ex.position.set(x, 0.3, -2.2);
    car.add(ex);
  }
  for (const x of [-0.92, 0.92]) {
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.06), mats.trim);
    stem.position.set(x * 0.94, 0.98, 0.7);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.18), mats.paint);
    m.position.set(x, 1.0, 0.68);
    car.add(stem, m);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.06), mats.trim);
  grille.position.set(0, 0.42, 2.17);
  car.add(grille);

  // wheels: flush with the fenders
  const wheels = [
    wheel(mats, 0.345, 0.27, 0.80, zf), wheel(mats, 0.345, 0.27, -0.80, zf),
    wheel(mats, WHEEL_R, 0.33, 0.78, zr), wheel(mats, WHEEL_R, 0.33, -0.78, zr),
  ];
  car.add(...wheels);

  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  car.userData = { wheels, paintMat: mats.paint, headMat: mats.head, tailMat: mats.tail, source: 'procedural' };
  return car;
}

// ---------- GLB path ----------

const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/';

/**
 * Load a car GLB and normalise it to the contract above.
 * opts.length   real length in metres to scale to (default: 992 GT3 RS)
 * opts.rotateY  extra yaw in radians if the model's nose does not end up on +Z
 * opts.paint    hex colour applied to the body-paint material(s)
 * opts.paintMatch regex tested against material names to find the paint
 * opts.wheelMatch regex tested against node names to find the wheels
 */
export async function loadCarModel(url, opts = {}) {
  const {
    length = L, rotateY = 0, paint = 0x1d4fc4,
    paintMatch = /paint|carpaint|car_paint|body|exterior/i,
    wheelMatch = /^wheel|wheel_|_wheel|tire|tyre/i,
    hideMatch = /blur/i,                       // motion-blur wheel variants baked into game models
    solidPaint = false,                        // true: drop a baked livery texture and run one clean colour
    steerMatch = /steer/i,                     // steering wheel meshes → re-pivoted so they can turn
    glowMatch = /display|led|racelogic|electronics/i, // screens and LEDs that should light up at night
    mirrorMatch = /mirror/i,                   // mirror glass → replaced with live planar reflectors
    mirrors = true,
    mirrorTilt = { interior: -14, side: -4 },  // degrees about the glass's horizontal axis; negative = look down
    eye = new THREE.Vector3(0.3, 0.95, -0.1),  // driver's eye, car space: decides which way mirrors face
    onProgress = undefined,
  } = opts;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url, onProgress);
  const model = gltf.scene;

  // 1. scale + orient: longest horizontal axis becomes Z, length becomes `length`
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.add(model);
  if (size.x > size.z) model.rotation.y = -Math.PI / 2;
  model.rotation.y += rotateY;
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  size = box.getSize(new THREE.Vector3());
  const s = length / size.z;
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);

  // 2. materials: paint + shadows; find wheels (outermost node whose name says wheel)
  const wheels = [];
  let paintMat = null, headMat = null, tailMat = null;
  let biggest = null, biggestArea = 0;
  const glowMats = new Set();
  const underWheel = (o) => { for (let p = o.parent; p && p !== model; p = p.parent) if (wheelMatch.test(p.name || '')) return true; return false; };
  model.traverse((o) => {
    if (o !== model && hideMatch.test(o.name || '')) o.visible = false;
    if (wheelMatch.test(o.name || '') && !underWheel(o)) wheels.push(o);
    if (!o.isMesh) return;
    o.castShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!paintMat && paintMatch.test(m.name || '')) paintMat = m;
      if (!headMat && /head|light_front|front_light/i.test(m.name || '')) headMat = m;
      if (!tailMat && /tail|brake|light_rear|rear_light/i.test(m.name || '')) tailMat = m;
      // dash screens / LEDs: let their own texture glow (intensity is driven by time of day)
      if (glowMatch.test(m.name || '') && m.map && 'emissive' in m) { m.emissive.set(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0; m.needsUpdate = true; glowMats.add(m); }
    }
    o.geometry.computeBoundingBox();
    const bs = o.geometry.boundingBox.getSize(new THREE.Vector3());
    const area = bs.x * bs.y + bs.y * bs.z + bs.x * bs.z;
    if (area > biggestArea) { biggestArea = area; biggest = o; }
  });
  if (!paintMat && biggest) paintMat = Array.isArray(biggest.material) ? biggest.material[0] : biggest.material;
  const liveryMap = paintMat ? paintMat.map : null;
  if (paintMat) {
    if (solidPaint && paintMat.map) { paintMat.map = null; paintMat.needsUpdate = true; }
    if (paintMat.color) paintMat.color.set(solidPaint || !liveryMap ? paint : 0xffffff);
    paintMat.metalness = Math.min(paintMat.metalness ?? 0.5, 0.6);
    paintMat.roughness = Math.max(paintMat.roughness ?? 0.3, 0.25);
    if ('clearcoat' in paintMat) { paintMat.clearcoat = 1; paintMat.clearcoatRoughness = 0.06; }
  }
  // Wheels rarely pivot at their own hub (game exports keep the car origin), so spinning them would
  // orbit the car. Re-parent each under a pivot placed at its bounding-box centre; spin the pivot.
  model.updateMatrixWorld(true);
  // steering wheel: the rim is a flat disc, so a plane fit gives its centre and the column axis exactly.
  // The pivot's local Z is that axis; scene code sets pivot.rotation.z = steer angle.
  const steerMeshes = [];
  model.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (steerMatch.test(o.name || '') || ms.some((m) => steerMatch.test(m?.name || ''))) steerMeshes.push(o); } });
  let steeringWheel = null;
  if (steerMeshes.length) {
    // the wheel face is the flattest sizeable part; the hub/column is deep and would tilt the axis
    const flat = (f) => (f.halfW * f.halfH) / Math.max(f.halfT, 0.005);
    const rim = steerMeshes.map((m) => ({ m, f: planeFit(m) })).sort((a, b) => flat(b.f) - flat(a.f))[0];
    // pivot +Z points at the driver, so a positive rotation.z is anticlockwise from the seat = a left turn
    if (rim.f.normal.z > 0) { rim.f.normal.negate(); rim.f.e2.negate(); }
    steeringWheel = new THREE.Group(); steeringWheel.name = 'pivot:steering';
    steeringWheel.position.copy(rim.f.center);
    steeringWheel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rim.f.e1, rim.f.e2, rim.f.normal));
    wrap.add(steeringWheel);
    // everything that sits on the wheel turns with it: the named steer parts near the face, plus any
    // mesh whose vertices all lie within the wheel's radius (decals, crest, knob labels) — the column stays
    const radius = Math.max(rim.f.halfW, rim.f.halfH) * 1.15;
    const onWheel = (m) => {
      const pos = m.geometry.attributes.position, mw = m.matrixWorld, v = new THREE.Vector3();
      let inside = 0;
      for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).applyMatrix4(mw).distanceTo(rim.f.center) < radius) inside++;
      return inside / pos.count > 0.95;
    };
    const attach = [];
    model.traverse((o) => { if (o.isMesh && (steerMeshes.includes(o) ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).distanceTo(rim.f.center) < 0.16 : onWheel(o))) attach.push(o); });
    attach.forEach((m) => steeringWheel.attach(m));
  }

  // mirrors: each glass surface becomes a planar reflector facing the driver's eye
  const mirrorObjs = [];
  if (mirrors) {
    const glass = [];
    model.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some((m) => mirrorMatch.test(m?.name || ''))) glass.push(o); } });
    for (const g of glass) {
      const f = planeFit(g);
      if (f.halfW < 0.02 || f.halfH < 0.02) continue;
      if (f.normal.dot(eye.clone().sub(f.center)) < 0) { f.normal.negate(); f.e2.negate(); }
      // aim: rotate the glass about its horizontal axis so the reflection covers the road behind, not the roof
      const interior = Math.abs(f.center.x) < 0.35;
      const tilt = THREE.MathUtils.degToRad(interior ? mirrorTilt.interior : mirrorTilt.side);
      const horiz = (Math.abs(f.e1.y) < Math.abs(f.e2.y) ? f.e1 : f.e2).clone().normalize(); // the in-plane axis closest to level
      // the axis direction is arbitrary, so try both senses and keep the one that lowers the normal
      const qa = new THREE.Quaternion().setFromAxisAngle(horiz, tilt), qb = new THREE.Quaternion().setFromAxisAngle(horiz, -tilt);
      const q = f.normal.clone().applyQuaternion(qa).y < f.normal.clone().applyQuaternion(qb).y ? qa : qb;
      f.normal.applyQuaternion(q); f.e1.applyQuaternion(q); f.e2.applyQuaternion(q);
      const r = new Reflector(new THREE.PlaneGeometry(f.halfW * 1.9, f.halfH * 1.9), { textureWidth: 512, textureHeight: 256, clipBias: 0.003, color: 0xb8bcc4 });
      r.name = 'mirror:' + (g.name || 'glass');
      r.position.copy(f.center).addScaledVector(f.normal, 0.003);
      r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.e1, f.e2, f.normal));
      wrap.add(r);
      g.visible = false;
      mirrorObjs.push(r);
    }
  }
  const pivots = wheels.map((w) => {
    const c = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = 'pivot:' + (w.name || 'wheel');
    pivot.position.copy(c);
    wrap.add(pivot);
    pivot.attach(w);
    return pivot;
  });
  const fallback = carMaterials(paint);
  wrap.userData = { wheels: pivots, steeringWheel, mirrors: mirrorObjs, liveryMap, glowMats: [...glowMats], paintMat: paintMat || fallback.paint, headMat: headMat || fallback.head, tailMat: tailMat || fallback.tail, source: url, triangles: countTriangles(model) };
  return wrap;
}

function countTriangles(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; n += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
  return Math.round(n);
}

/** Paint a loaded car: a hex colour for solid paint, or null to restore its livery texture (if it has one). */
export function setCarPaint(car, hex) {
  const m = car.userData.paintMat, livery = car.userData.liveryMap;
  if (!m) return;
  if (hex === null || hex === undefined) {
    if (livery) { m.map = livery; m.color.set(0xffffff); }
  } else {
    m.map = null; m.color.set(hex);
  }
  m.needsUpdate = true;
}
