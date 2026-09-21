// Procedural race-track scene for the scroll-driven home page.
// Everything here is built in code: track spline, road, kerbs, sky/sun, rain,
// trackside props, a placeholder car ahead and the cockpit rig. No external assets.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { buildProceduralGT3, loadCarModel, setCarPaint } from './car.js?v=6';
import { loadTrackModel } from './track.js?v=2';

// Drop a model here and it replaces the procedural car. First URL that exists wins:
// a single GLB, or Sketchfab's extracted zip (models/gt3/scene.gltf + scene.bin + textures/).
// rotateY: extra yaw if the nose does not land on +Z after auto-orientation.
const CAR_MODEL = { urls: ['./assets/models/gt3.glb', './assets/models/2024_porsche_992_gt3_r/scene.gltf'], rotateY: 0 };

const UP = new THREE.Vector3(0, 1, 0);
const ROAD_W = 12;
const KERB_W = 1.1;

// ---------- small helpers ----------

function noiseTexture(size, base, spread, blurPasses, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let pass = 0; pass < 3; pass++) {
    const s = [1, 3, 9][pass];
    const n = Math.floor((size * size) / (s * s) * 0.6);
    for (let i = 0; i < n; i++) {
      const v = base + (Math.random() - 0.5) * spread * (pass === 0 ? 1 : 0.6);
      ctx.fillStyle = `rgba(${v},${v},${v},${pass === 0 ? 0.9 : 0.35})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
    }
  }
  for (let i = 0; i < blurPasses; i++) {
    ctx.filter = 'blur(1px)';
    ctx.drawImage(c, 0, 0);
  }
  ctx.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#111';
    ctx.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ribbon geometry along a curve: [innerOffset, outerOffset] measured from the centre line
// (negative = left). `colorFn(i, u)` may return a THREE.Color for vertex colours.
function ribbon(curve, samples, offsetA, offsetB, y, uvRepeat, colorFn, yFn) {
  const pos = [], uv = [], col = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    curve.getPointAt(u % 1, p);
    curve.getTangentAt(u % 1, t);
    side.crossVectors(t, UP).normalize();
    const yy = yFn ? yFn(i, u) : y;
    const a = p.clone().addScaledVector(side, offsetA);
    const b = p.clone().addScaledVector(side, offsetB);
    pos.push(a.x, p.y + yy, a.z, b.x, p.y + yy, b.z);
    uv.push(u * uvRepeat, 0, u * uvRepeat, 1);
    if (colorFn) { const c = colorFn(i, u); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (i < samples) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Signed curvature: positive = turning left.
function curvatureAt(curve, u, du = 0.002) {
  const a = curve.getTangentAt(u % 1);
  const b = curve.getTangentAt((u + du) % 1);
  return new THREE.Vector3().crossVectors(a, b).y / du;
}

// ---------- the scene ----------

export function createTrackScene(canvas, options = {}) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb3c8, 0.0022);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2500);

  // --- track spline ---
  // Either a path traced from a real track model (options.track = { model, waypoints, closed }),
  // or the built-in procedural circuit (metres; closed loop, gently undulating).
  const trackOpt = options.track || null;
  const pts2 = [
    [0, 0], [130, 0], [210, -35], [235, -120], [180, -185], [90, -175],
    [30, -225], [-80, -250], [-165, -190], [-180, -95], [-125, -30], [-55, 10],
  ];
  const points = trackOpt
    ? trackOpt.waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    : pts2.map(([x, z], i) => new THREE.Vector3(x, Math.sin(i * 1.7) * 1.6 + Math.cos(i * 0.9) * 1.1, z));
  const curve = new THREE.CatmullRomCurve3(points, trackOpt ? trackOpt.closed !== false : true, 'centripetal', trackOpt ? 0.5 : 0.6);
  const trackLength = curve.getLength();
  const SAMPLES = 900;

  // --- materials & textures ---
  const asphaltTex = noiseTexture(512, 78, 70, 2, 1);
  asphaltTex.repeat.set(1, 1);
  let roadMat = new THREE.MeshStandardMaterial({
    color: 0x35363a, map: asphaltTex, roughnessMap: asphaltTex, roughness: 0.92, metalness: 0.02,
  });
  const grassTex = noiseTexture(512, 110, 90, 1, 60);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f6b32, map: grassTex, roughness: 1 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7, emissive: 0x222222 });
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

  if (!trackOpt) {
  // --- road ---
  const road = new THREE.Mesh(ribbon(curve, SAMPLES, -ROAD_W / 2, ROAD_W / 2, 0, trackLength / 7), roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // edge lines
  scene.add(new THREE.Mesh(ribbon(curve, SAMPLES, -ROAD_W / 2 + 0.25, -ROAD_W / 2 + 0.45, 0.012, 1), lineMat));
  scene.add(new THREE.Mesh(ribbon(curve, SAMPLES, ROAD_W / 2 - 0.45, ROAD_W / 2 - 0.25, 0.012, 1), lineMat));

  // kerbs on corners only (hidden below the grass on straights)
  const red = new THREE.Color(0xc8352a), white = new THREE.Color(0xededed);
  const kerbCurv = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) kerbCurv[i] = curvatureAt(curve, i / SAMPLES);
  const kerbColor = (i, u) => (Math.floor(u * trackLength / 3) % 2 ? red : white);
  const kerbY = (i) => (Math.abs(kerbCurv[i]) > 0.75 ? 0.015 : -0.4);
  scene.add(new THREE.Mesh(ribbon(curve, SAMPLES, -ROAD_W / 2 - KERB_W, -ROAD_W / 2, 0, 1, kerbColor, kerbY), kerbMat));
  scene.add(new THREE.Mesh(ribbon(curve, SAMPLES, ROAD_W / 2, ROAD_W / 2 + KERB_W, 0, 1, kerbColor, kerbY), kerbMat));

  // start / finish strip
  const sfMat = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 });
  const sfGeom = ribbon(curve, 6, -ROAD_W / 2, ROAD_W / 2, 0.014, 1);
  // ribbon() samples u in [0, 1]; squeeze it to a 4 m strip at u≈0.998..1
  {
    const p = sfGeom.attributes.position, uvs = sfGeom.attributes.uv;
    const P = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3();
    for (let i = 0; i <= 6; i++) {
      const u = (1 - (i / 6) * (4 / trackLength)) % 1;
      curve.getPointAt(u, P); curve.getTangentAt(u, T); S.crossVectors(T, UP).normalize();
      const a = P.clone().addScaledVector(S, -ROAD_W / 2), b = P.clone().addScaledVector(S, ROAD_W / 2);
      p.setXYZ(i * 2, a.x, P.y + 0.014, a.z); p.setXYZ(i * 2 + 1, b.x, P.y + 0.014, b.z);
      uvs.setXY(i * 2, i / 6, 0); uvs.setXY(i * 2 + 1, i / 6, 1);
    }
    p.needsUpdate = true; uvs.needsUpdate = true; sfGeom.computeVertexNormals();
  }
  scene.add(new THREE.Mesh(sfGeom, sfMat));

  } // procedural road

  // --- ground & hills ---
  if (!trackOpt) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);
  }

  const hillMat = new THREE.MeshStandardMaterial({ color: 0x2a3a47, roughness: 1, flatShading: true });
  const makeHills = (r0, r1, h0, h1, seed) => {
    const N = 96, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = h0 + h1 * (0.5 + 0.5 * Math.sin(a * 3 + seed) * Math.cos(a * 7 + seed * 2));
      pos.push(Math.cos(a) * r0, -2, Math.sin(a) * r0, Math.cos(a) * r1, h, Math.sin(a) * r1);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, hillMat);
  };
  if (!trackOpt) {
    scene.add(makeHills(520, 760, 18, 55, 1.3));
    scene.add(makeHills(760, 1100, 40, 120, 4.1));
  }

  // --- trackside props ---
  const props = new THREE.Group();
  scene.add(props);

  if (!trackOpt) {
  // barriers on corner outsides
  const barrierGeom = new THREE.BoxGeometry(4, 1, 0.35);
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.6 });
  const barrierMats = [];
  {
    const P = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3();
    const step = 4 / trackLength;
    for (let u = 0; u < 1; u += step) {
      const k = curvatureAt(curve, u);
      if (Math.abs(k) < 0.5) continue;
      curve.getPointAt(u, P); curve.getTangentAt(u, T); S.crossVectors(T, UP).normalize();
      const outside = k > 0 ? 1 : -1; // turning left → barrier on the right
      const m = new THREE.Matrix4();
      const pos = P.clone().addScaledVector(S, outside * (ROAD_W / 2 + 5.5)); pos.y += 0.5;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), T.clone().normalize());
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      barrierMats.push(m);
    }
  }
  const barriers = new THREE.InstancedMesh(barrierGeom, barrierMat, barrierMats.length);
  barrierMats.forEach((m, i) => barriers.setMatrixAt(i, m));
  barriers.castShadow = true; barriers.receiveShadow = true;
  props.add(barriers);

  } // procedural barriers

  // light poles + lamps (spotlights only light up at night)
  const poles = [];
  const poleGeom = new THREE.CylinderGeometry(0.14, 0.2, 9, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.6 });
  const lampGeom = new THREE.BoxGeometry(1.2, 0.25, 0.5);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1c9, emissiveIntensity: 0 });
  const POLES = isMobile ? 6 : 10;
  for (let i = 0; i < POLES; i++) {
    const u = i / POLES;
    const P = curve.getPointAt(u), T = curve.getTangentAt(u), S = new THREE.Vector3().crossVectors(T, UP).normalize();
    const sideSign = i % 2 ? 1 : -1;
    const base = P.clone().addScaledVector(S, sideSign * (ROAD_W / 2 + 4));
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.copy(base).setY(P.y + 4.5);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.2), poleMat);
    arm.position.set(0, 4.4, 0);
    arm.lookAt(arm.position.clone().add(S.clone().multiplyScalar(-sideSign)));
    pole.add(arm);
    const lamp = new THREE.Mesh(lampGeom, lampMat);
    lamp.position.copy(base).addScaledVector(S, -sideSign * 3).setY(P.y + 8.9);
    lamp.lookAt(lamp.position.clone().add(T));
    const light = new THREE.SpotLight(0xffe2b0, 0, 40, Math.PI / 3.2, 0.5, 1.4);
    light.position.copy(lamp.position);
    light.target.position.copy(P).addScaledVector(S, -sideSign * 1.5);
    props.add(pole, lamp, light, light.target);
    poles.push({ light });
  }

  if (!trackOpt) {
  // trees (instanced cones + trunks), kept clear of the track
  {
    const N = isMobile ? 220 : 420;
    const samplePts = [];
    for (let i = 0; i < 240; i++) samplePts.push(curve.getPointAt(i / 240));
    const trunkGeom = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6);
    const crownGeom = new THREE.ConeGeometry(2.6, 7, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, N);
    const crowns = new THREE.InstancedMesh(crownGeom, crownMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let placed = 0, guard = 0;
    while (placed < N && guard++ < N * 30) {
      const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900 - 110;
      let dmin = 1e9;
      for (const sp of samplePts) { const d = (sp.x - x) ** 2 + (sp.z - z) ** 2; if (d < dmin) dmin = d; }
      if (dmin < 26 * 26) continue;
      if (Math.abs(x - 40) < 60 && Math.abs(z + 40) < 40) continue; // grandstand area
      const s = 0.7 + Math.random() * 0.9;
      q.setFromAxisAngle(UP, Math.random() * Math.PI);
      m.compose(new THREE.Vector3(x, 1.1 * s, z), q, new THREE.Vector3(s, s, s)); trunks.setMatrixAt(placed, m);
      m.compose(new THREE.Vector3(x, (2.2 + 3.5) * s, z), q, new THREE.Vector3(s, s, s)); crowns.setMatrixAt(placed, m);
      placed++;
    }
    trunks.count = crowns.count = placed;
    const tint = new THREE.Color();
    for (let i = 0; i < placed; i++) { tint.setHSL(0.3 + Math.random() * 0.06, 0.35 + Math.random() * 0.25, 0.16 + Math.random() * 0.12); crowns.setColorAt(i, tint); }
    crowns.instanceColor.needsUpdate = true;
    crowns.castShadow = true;
    props.add(trunks, crowns);
  }

  // grandstand on the inside of the main straight
  {
    const gs = new THREE.Group();
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x33384a, roughness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, roughness: 0.4, metalness: 0.5 });
    for (let r = 0; r < 6; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(70, 0.9, 2.2), seatMat);
      step.position.set(0, 0.45 + r * 0.9, -r * 2.2);
      step.castShadow = true; step.receiveShadow = true;
      gs.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(74, 0.3, 16), railMat);
    roof.position.set(0, 9.5, -6);
    gs.add(roof);
    for (const x of [-34, -17, 0, 17, 34]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9.5, 8), railMat);
      post.position.set(x, 4.75, -13);
      gs.add(post);
    }
    gs.position.set(60, 0, -22);
    gs.rotation.y = Math.PI;
    props.add(gs);
  }

  // start/finish gantry
  {
    const P = curve.getPointAt(0), T = curve.getTangentAt(0), S = new THREE.Vector3().crossVectors(T, UP).normalize();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.4 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 6, 1.4, 1.2), mat);
    beam.position.copy(P).setY(P.y + 7.2);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), S);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.5, 0.6), mat);
      post.position.copy(P).addScaledVector(S, s * (ROAD_W / 2 + 2.5)).setY(P.y + 3.75);
      props.add(post);
    }
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ color: 0x0b0d12, emissive: 0xff3b30, emissiveIntensity: 0.9 }));
    panel.position.copy(P).setY(P.y + 6.2).addScaledVector(T, 0.7);
    panel.lookAt(panel.position.clone().add(T));
    props.add(beam, panel);
  }

  } // procedural trees / grandstand / gantry

  // --- assets: real track + cars. Nothing car-related is shown until they have loaded (or failed and
  // fallen back to the procedural GT3); `ready` resolves once everything is in and shaders are warm.
  const progress = { track: 0, cars: 0 };
  const report = () => options.onProgress && options.onProgress({ ...progress });
  const onProgress = (key) => (e) => { if (e && e.lengthComputable) progress[key] = e.loaded / e.total; else if (e && e.loaded) progress[key] = Math.min(0.95, e.loaded / 4e7); report(); };

  const trackLoad = (trackOpt && trackOpt.model)
    ? loadTrackModel(trackOpt.model, { onProgress: onProgress('track') }).then(({ root, asphaltMat, triangles }) => {
        scene.add(root);
        if (asphaltMat) { roadMat = asphaltMat; setRain(state.rain); }
        progress.track = 1; report();
        console.info(`[track] track model loaded: ${trackOpt.model} (${triangles.toLocaleString()} tris)`);
      }).catch((e) => console.warn('[track] track model failed to load:', e))
    : Promise.resolve();

  const PAINT_AHEAD = 0xd8342a, PAINT_PLAYER = 0x1d4fc4;
  let carAhead = null, playerCar = null;
  const cockpitLight = new THREE.PointLight(0xffc98a, 0, 2.6, 1.6);
  cockpitLight.position.set(0.25, 0.95, 0.55);
  const placeCars = (a, p) => {
    carAhead = a; playerCar = p;
    scene.add(carAhead, playerCar);
    playerCar.add(cockpitLight);
    (playerCar.userData.mirrors || []).forEach((m, i) => {
      const render = m.onBeforeRender;
      m.onBeforeRender = function (...a) { if ((state.frame + i) % 2 === 0) render.apply(this, a); };
    });
    state.carsReady = true;
    setCameraMode(state.cameraMode);
    setTime(state.hour);
  };
  const carLoad = (async () => {
    let url = null;
    for (const u of CAR_MODEL.urls) { try { if ((await fetch(u, { method: 'HEAD' })).ok) { url = u; break; } } catch (e) { /* keep looking */ } }
    if (url) {
      try {
        const [a, p] = await Promise.all([
          loadCarModel(url, { rotateY: CAR_MODEL.rotateY, paint: PAINT_AHEAD, mirrors: false, onProgress: onProgress('cars') }),
          loadCarModel(url, { rotateY: CAR_MODEL.rotateY, paint: PAINT_PLAYER }),
        ]);
        placeCars(a, p);
        progress.cars = 1; report();
        console.info(`[track] car model loaded: ${url} (${a.userData.triangles.toLocaleString()} tris)`);
        return;
      } catch (e) { console.warn('[track] car model failed to load, using the procedural GT3:', e); }
    } else console.info('[track] no car model in assets/models — using the procedural GT3');
    placeCars(buildProceduralGT3(PAINT_AHEAD), buildProceduralGT3(PAINT_PLAYER));
    progress.cars = 1; report();
  })();

  const ready = Promise.all([trackLoad, carLoad]).then(async () => {
    // upload every texture and compile every program now, while the curtain is still down
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) renderer.initTexture(v); }
    });
    try { await renderer.compileAsync(scene, camera); } catch (e) { /* first frames compile lazily instead */ }
    composer ? composer.render() : renderer.render(scene, camera);
  });

  // --- cockpit rig (attached to the camera) ---
  const rig = new THREE.Group();
  const hoodMat = new THREE.MeshPhysicalMaterial({ color: 0x1d4fc4, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });
  {
    const hoodGeom = new THREE.BoxGeometry(1.8, 0.06, 2.3);
    // taper the far end so it reads as a bonnet, not a plank
    { const p = hoodGeom.attributes.position; for (let i = 0; i < p.count; i++) { if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * 0.82); p.setY(i, p.getY(i) - 0.16); } } p.needsUpdate = true; hoodGeom.computeVertexNormals(); }
    const hood = new THREE.Mesh(hoodGeom, hoodMat);
    hood.position.set(0, -0.78, -2.35); hood.rotation.x = 0.1;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x0f1115, roughness: 0.9 }));
    dash.position.set(0, -0.5, -0.75);
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 12, 40), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 }));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.02), rim.material);
    const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.02), rim.material); spoke2.position.y = -0.09;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.025), new THREE.MeshStandardMaterial({ color: 0xffb627, emissive: 0xffb627, emissiveIntensity: 0.6 })); mark.position.y = 0.17;
    wheel.add(rim, spoke, spoke2, mark);
    wheel.position.set(0, -0.44, -0.74); wheel.rotation.x = -0.4;
    rig.add(hood, dash, wheel);
    rig.userData = { wheel };
  }
  camera.add(rig);
  scene.add(camera);

  // POV headlights (night only)
  const headlight = new THREE.SpotLight(0xfff4dc, 0, 90, Math.PI / 5, 0.6, 1.2);
  headlight.position.set(0, -0.3, -2.8);
  headlight.target.position.set(0, -2.2, -34);
  camera.add(headlight, headlight.target);

  // --- sky, sun, environment ---
  const sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);
  const sun = new THREE.Vector3();
  const sunLight = new THREE.DirectionalLight(0xffffff, 3);
  sunLight.castShadow = !isMobile;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 400;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -90;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top = 90;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a4a2a, 0.6);
  scene.add(hemi);

  // stars for night
  const stars = (() => {
    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 1800; pos[i * 3 + 1] = Math.cos(ph) * 1800; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 1800;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
    return new THREE.Points(g, m);
  })();
  scene.add(stars);

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function refreshEnvironment() {
    const s = new THREE.Scene();
    s.add(sky);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(s, 0.04);
    scene.environment = envRT.texture;
    scene.add(sky);
  }

  // --- rain ---
  const RAIN_N = isMobile ? 900 : 2200;
  const rainGeom = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainBox = { x: 50, y: 24, z: 50 };
  for (let i = 0; i < RAIN_N; i++) {
    const x = (Math.random() - 0.5) * rainBox.x, y = Math.random() * rainBox.y, z = (Math.random() - 0.5) * rainBox.z;
    rainPos.set([x, y, z, x, y + 0.7, z], i * 6);
  }
  rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xcfd8e6, transparent: true, opacity: 0.32, fog: true });
  const rain = new THREE.LineSegments(rainGeom, rainMat);
  rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);

  // --- post ---
  let composer = null, bloom = null, film = null;
  const basePixelRatio = renderer.getPixelRatio();
  if (!isMobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.35, 0.95);
    composer.addPass(bloom);
    composer.addPass(new SMAAPass(1, 1));        // edge anti-aliasing (MSAA doesn't survive the composer)
    film = new FilmPass(0.22, false);            // fine grain, colour kept
    composer.addPass(film);
    composer.addPass(new OutputPass());
  }

  // ---------- state ----------
  const state = {
    hour: 16, rain: 0.15, progress: 0, cameraMode: 'helmet',
    uSmooth: 0, uPrev: 0, uVel: 0, speedMps: 0, steer: 0, t: 0, frame: 0, carsReady: false, rivalLateral: 0.7,
    // car-local camera offsets [x, y, z, lookDrop] (forward +Z, +X = driver's left on this LHD model);
    // lookDrop lowers the aim point (metres at the look-ahead distance) so the dash and wheel stay in frame. Tweakable at runtime.
    camOffsets: { helmet: [0.3, 0.92, -0.32, 0.5], hood: [0, 0.92, 1.05, 0.2], chase: [0, 2.6, -8.5, 0] },
  };
  const listeners = { frame: [] };

  function setTime(hour) {
    state.hour = ((hour % 24) + 24) % 24;
    const dayT = (state.hour - 5.5) / 14; // 0 at 05:30 (sunrise), 1 at 19:30 (sunset)
    const elev = Math.sin(dayT * Math.PI) * 64; // degrees; negative at night
    const azim = 200 + (state.hour - 12) * 15;
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    sun.setFromSphericalCoords(1, phi, theta);
    const u = sky.material.uniforms;
    const lowSun = THREE.MathUtils.clamp(1 - elev / 25, 0, 1);
    u.sunPosition.value.copy(sun);
    u.turbidity.value = 6 + lowSun * 6;
    u.rayleigh.value = 1.2 + lowSun * 2.5;
    u.mieCoefficient.value = 0.004 + lowSun * 0.012;
    u.mieDirectionalG.value = 0.85;

    const daylight = THREE.MathUtils.clamp(Math.sin(THREE.MathUtils.degToRad(elev)) * 2.2, 0, 1);
    const night = 1 - THREE.MathUtils.smoothstep(elev, -8, 4);
    sunLight.position.copy(sun).multiplyScalar(300);
    sunLight.intensity = daylight * 1.9;
    sunLight.color.setHSL(0.09, 0.5 * lowSun, 0.5 + 0.5 * (1 - lowSun * 0.4));
    hemi.intensity = 0.11 + daylight * 0.3;
    hemi.color.setHSL(0.6, 0.4, 0.55 + 0.2 * daylight);
    renderer.toneMappingExposure = 0.34 + daylight * 0.16;
    scene.environmentIntensity = 0.12 + daylight * 0.2;
    scene.fog.color.setHSL(0.58, 0.25, 0.12 + daylight * 0.55);
    scene.fog.density = (0.0018 + state.rain * 0.002) * (1 + night * 0.6);
    stars.material.opacity = night * 0.9;
    for (const p of poles) p.light.intensity = night * 260;
    lampMat.emissiveIntensity = night * 3.5;
    headlight.intensity = night * 220;
    if (carAhead) {
      carAhead.userData.headMat.emissiveIntensity = night * 2.5;
      carAhead.userData.tailMat.emissiveIntensity = 0.8 + night * 1.6;
      for (const m of carAhead.userData.glowMats || []) m.emissiveIntensity = 0.15 + night * 0.9;
    }
    if (playerCar) {
      for (const m of playerCar.userData.glowMats || []) m.emissiveIntensity = 0.25 + night * 1.3;
      if (playerCar.userData.headMat) playerCar.userData.headMat.emissiveIntensity = night * 2.5;
    }
    cockpitLight.intensity = night * 1.6;
    cockpitLight.color.setHSL(0.08, 0.6, 0.62 + 0.1 * (1 - night));
    if (bloom) { bloom.strength = 0.18 + night * 0.17; bloom.threshold = 0.95 + night * 0.15; } // restrained at night: only true light sources bloom
    refreshEnvironment();
  }

  function setRain(amount) {
    state.rain = THREE.MathUtils.clamp(amount, 0, 1);
    rain.visible = state.rain > 0.01;
    rainGeom.setDrawRange(0, Math.floor(RAIN_N * state.rain) * 2);
    // wet road: darker, glossier, reflects the sky
    roadMat.roughness = (roadMat.map ? 1.0 : 0.92) - state.rain * 0.62;
    roadMat.metalness = 0.02 + state.rain * 0.12;
    // a textured asphalt keeps its map and only gets a wet darkening; the procedural one is tinted directly
    roadMat.color.setHex(roadMat.map ? (state.rain > 0.5 ? 0xb4b4b8 : 0xffffff) : (state.rain > 0.5 ? 0x25262a : 0x35363a));
    roadMat.needsUpdate = true;
    kerbMat.roughness = 0.6 - state.rain * 0.35;
    grassMat.color.setHex(0x3f6b32).multiplyScalar(1 - state.rain * 0.25);
    setTime(state.hour); // fog density depends on rain
  }

  // hex for solid paint, null for the model's livery
  function setPaint(hex) {
    if (hex != null) hoodMat.color.set(hex);
    if (playerCar) setCarPaint(playerCar, hex);
  }

  function setCarAheadPaint(hex) {
    if (carAhead) setCarPaint(carAhead, hex);
  }

  // With a real model the camera rides inside the actual car; the placeholder rig only serves the procedural fallback.
  const realCar = () => !!playerCar && playerCar.userData.source !== 'procedural';
  function setCameraMode(mode) {
    state.cameraMode = mode;
    if (!state.carsReady) { rig.visible = false; return; }
    rig.visible = mode !== 'chase' && !realCar();
    playerCar.visible = mode === 'chase' || realCar();
    // mirrors cost a scene render each; only pay for them from inside the car
    for (const m of playerCar.userData.mirrors || []) m.visible = mode !== 'chase';
  }

  // distance along the circuit in laps; unbounded, the curve wraps
  // 0–1: film grain amount (0 = off)
  function setGrain(v) {
    if (film) film.uniforms.intensity.value = THREE.MathUtils.clamp(v, 0, 1) * 0.6;
  }
  // 0–1: render softness — lowers the internal resolution, the composer upscales it
  function setSoft(v) {
    renderer.setPixelRatio(basePixelRatio * (1 - THREE.MathUtils.clamp(v, 0, 1) * 0.55));
  }

  function setProgress(p) {
    state.progress = Math.max(0, p);
  }

  function onFrame(fn) { listeners.frame.push(fn); }

  // ---------- per-frame ----------
  const mouse = { x: 0, y: 0 }, glance = { x: 0, y: 0 }; // raw pointer → eased glance
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const tmpP = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camLocal = new THREE.Vector3();
  const carPose = new THREE.Object3D(); // where the player car is (or would be) on the spline
  const heading = new THREE.Vector3(), lookTarget = new THREE.Vector3(); // smoothed direction of travel; car-space aim point
  const clock = new THREE.Clock();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      composer && composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    state.t += dt; state.frame++;
    resize();

    // scroll → track position, damped; velocity → speed
    const target = state.progress;
    if (reduced) { state.uSmooth = target; }
    else {
      // SmoothDamp (critically damped spring): no lurch on a wheel notch, no overshoot at the end
      const smoothTime = 0.55, omega = 2 / smoothTime, x = omega * dt;
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = state.uSmooth - target, temp = (state.uVel + omega * change) * dt;
      state.uVel = (state.uVel - omega * temp) * exp;
      state.uSmooth = target + (change + temp) * exp;
    }
    const du = state.uSmooth - state.uPrev;
    state.uPrev = state.uSmooth;
    const instMps = Math.min(84, Math.abs(du) * trackLength / Math.max(dt, 1e-3)); // cap ≈ 190 mph
    state.speedMps += (instMps - state.speedMps) * Math.min(1, dt * (instMps > state.speedMps ? 2.2 : 1.1));
    const u = ((state.uSmooth % 1) + 1) % 1;
    const metres = Math.abs(du) * trackLength; // distance covered this frame

    // steering from curvature — eased by distance (2.5 m) with a slow time floor, so it keeps up at any pace
    const k = (curvatureAt(curve, (u + 0.996) % 1, 0.006) + curvatureAt(curve, u, 0.006) + curvatureAt(curve, (u + 0.004) % 1, 0.006)) / 3;
    state.steer += (THREE.MathUtils.clamp(k * 0.35, -1, 1) - state.steer) * Math.min(1, metres / 2.5 + dt * 1.5);

    // player car on the spline (its pose defines every camera); heading catches up within ~1.5 m of travel
    curve.getPointAt(u, tmpP); curve.getTangentAt(u, tmpT);
    if (heading.lengthSq() === 0) heading.copy(tmpT);
    heading.lerp(tmpT, Math.min(1, metres / 1.5 + dt * 2)).normalize();
    tmpT.copy(heading);
    tmpS.crossVectors(tmpT, UP).normalize();
    const speedN = THREE.MathUtils.clamp(state.speedMps / 70, 0, 1);
    carPose.position.copy(tmpP).addScaledVector(tmpS, -0.4);
    carPose.lookAt(carPose.position.clone().add(tmpT));
    carPose.rotateZ(-state.steer * 0.02);
    carPose.updateMatrixWorld(true);
    if (playerCar) { playerCar.position.copy(carPose.position); playerCar.quaternion.copy(carPose.quaternion); playerCar.updateMatrixWorld(true); }
    const real = realCar();

    glance.x += (mouse.x - glance.x) * Math.min(1, dt * 5);
    glance.y += (mouse.y - glance.y) * Math.min(1, dt * 5);
    // camera: car-local offsets (forward +Z, +X = driver's left on this LHD model)
    const mode = state.cameraMode;
    let lookAhead = 14;
    const off = state.camOffsets[mode] || state.camOffsets.helmet;
    if (mode === 'chase') { camLocal.set(...off); lookAhead = 22; }
    else if (mode === 'hood') camLocal.set(...(real ? off : [0, 0.85, 1.2]));
    else camLocal.set(...(real ? off : [0, 1.15, 0]));
    camPos.copy(camLocal).applyMatrix4(carPose.matrixWorld);
    camPos.y += reduced ? 0 : Math.sin(state.t * 5.5) * 0.003 * (0.3 + speedN);
    camera.position.copy(camPos);
    // aim in the car's own frame: a point `lookAhead` metres in front of the eye, nudged toward the
    // inside of the corner and lowered by lookDrop. Always ahead of the driver, so the head never
    // swings round; mouse influence is a slight glance, nothing more.
    lookTarget.set(
      camLocal.x + state.steer * 2.2 + glance.x * 2.0,   // ≈ ±8° at the look-ahead distance
      camLocal.y - (off[3] || 0) - glance.y * 1.0,       // ≈ ±4°
      camLocal.z + lookAhead,
    ).applyMatrix4(carPose.matrixWorld);
    camera.lookAt(lookTarget);
    camera.rotateZ(-state.steer * 0.018);
    camera.fov += ((mode === 'chase' ? 58 : mode === 'helmet' ? 72 : 66) + speedN * 8 - camera.fov) * Math.min(1, dt * 1.5);
    camera.updateProjectionMatrix();

    rig.userData.wheel.rotation.z = state.steer * 1.4;
    if (playerCar && playerCar.userData.steeringWheel) playerCar.userData.steeringWheel.rotation.z = state.steer * 1.4;

    // the rival: close racing without theatre. Everything is a function of distance driven, so it
    // sits still when you do. Gap breathes between ~7 m and ~17 m over a few hundred metres and
    // closes up in the corners (it brakes later than you); its line is a racing line — a little
    // toward the inside of each bend — never a dodge out of your way, and never behind you.
    if (carAhead) {
      const dist = state.uSmooth * trackLength;
      const gap = 12 + 5 * Math.sin((dist / 260) * Math.PI * 2) - 4 * Math.min(1, Math.abs(state.steer));
      const lineTarget = 0.7 + state.steer * 1.6;                   // inside of the corner
      state.rivalLateral += (lineTarget - state.rivalLateral) * Math.min(1, metres / 8);
      const ua = (u + gap / trackLength) % 1;
      curve.getPointAt(ua, tmpP); curve.getTangentAt(ua, tmpT);
      carAhead.position.copy(tmpP).addScaledVector(new THREE.Vector3().crossVectors(tmpT, UP).normalize(), state.rivalLateral);
      carAhead.lookAt(carAhead.position.clone().add(tmpT));
      const spin = (state.speedMps / 0.36) * dt;
      for (const w of carAhead.userData.wheels) w.rotation.x += spin;
      for (const w of playerCar.userData.wheels) w.rotation.x += spin;
    }

    // sun shadow follows the camera
    sunLight.target.position.copy(camera.position);
    sunLight.position.copy(sun).multiplyScalar(260).add(camera.position);

    // rain follows the camera (world-aligned), falls and wraps
    if (rain.visible) {
      rain.position.set(camera.position.x, camera.position.y - rainBox.y * 0.5, camera.position.z);
      const a = rainGeom.attributes.position.array;
      const fall = (26 + state.speedMps * 0.35) * dt;
      const drift = state.speedMps * dt * 0.9;
      for (let i = 0; i < RAIN_N; i++) {
        const o = i * 6;
        a[o + 1] -= fall; a[o + 4] -= fall;
        a[o + 2] += drift; a[o + 5] += drift;
        if (a[o + 1] < 0) { const y = rainBox.y; a[o + 1] = y; a[o + 4] = y + 0.7; }
        if (a[o + 2] > rainBox.z / 2) { a[o + 2] -= rainBox.z; a[o + 5] -= rainBox.z; }
      }
      rainGeom.attributes.position.needsUpdate = true;
    }

    for (const fn of listeners.frame) fn({ u, speedMps: state.speedMps, steer: state.steer, hour: state.hour });
    composer ? composer.render() : renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // mini-map: the real spline projected to a 2D polyline
  function trackOutline(n = 160) {
    const pts = [];
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); pts.push(p); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const w = maxX - minX, h = maxZ - minZ, s = 100 / Math.max(w, h);
    return { points: pts.map(p => [(p.x - minX) * s + 10, (p.z - minZ) * s + 10]), scale: s, minX, minZ };
  }
  function trackPoint2D(u) {
    const o = trackOutline.cache || (trackOutline.cache = trackOutline());
    const p = curve.getPointAt(((u % 1) + 1) % 1);
    return [(p.x - o.minX) * o.scale + 10, (p.z - o.minZ) * o.scale + 10];
  }

  setRain(state.rain); // also applies the time of day
  setCameraMode('helmet');
  requestAnimationFrame(frame);

  return { ready, setTime, setRain, setGrain, setSoft, setPaint, setCarAheadPaint, setCameraMode, setProgress, onFrame, trackOutline, trackPoint2D, trackLength, state, get cars() { return { ahead: carAhead, player: playerCar }; }, _debug: { scene, renderer, get composer() { return composer; }, sunLight, camera } };
}
