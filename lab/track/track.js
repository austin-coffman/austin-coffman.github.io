// Track model loading. The model is used exactly as published (CC-BY-ND friendly): no geometry or
// texture edits, only render flags. The driving line comes from a separate path file traced in track.html.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/';

/**
 * Load a track GLB/glTF. Returns { root, asphaltMat, triangles }.
 * opts.roadMatch   material/node name regex for the driving surface (gets receiveShadow + wet-road tweaks)
 * opts.groundMatch material/node name regex for terrain (receiveShadow only)
 * opts.noShadow    node/material regex for things that should not cast (alpha-blended foliage looks blobby)
 */
export async function loadTrackModel(url, opts = {}) {
  const { roadMatch = /asphalt|road/i, groundMatch = /ground|terrain/i, noShadow = /leaf|leaves|foliage|tree/i, hideMatch = /banner/i } = opts;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  root.name = 'track:' + url;

  let asphaltMat = null, triangles = 0;
  root.traverse((o) => {
    if (o !== root && hideMatch.test(o.name || '')) o.visible = false; // sponsor boards etc. — render-time only, file untouched
    if (!o.isMesh) return;
    const g = o.geometry;
    triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const names = [o.name, o.parent?.name, ...mats.map((m) => m?.name)].join(' ');
    const isRoad = roadMatch.test(names), isGround = groundMatch.test(names);
    o.receiveShadow = true;
    o.castShadow = !isRoad && !isGround && !noShadow.test(names);
    if (isRoad && !asphaltMat) asphaltMat = mats.find((m) => m && roadMatch.test(m.name || '')) || mats[0];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.anisotropy = 8;
      // baked alpha foliage: alpha test reads far cleaner than blending against the sky
      if (m.transparent && noShadow.test(names)) { m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; m.needsUpdate = true; }
    }
  });
  return { root, asphaltMat, triangles: Math.round(triangles) };
}
