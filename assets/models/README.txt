Car models go here. See assets/js/car.js for the contract.

- a single-file GLB, or Sketchfab's extracted zip layout (scene.gltf + scene.bin + textures/)
- point CAR_MODEL.url in assets/js/scene.js at it, and update the matching preload in index.html's <head>

Credit the author in the site footer for CC-BY models.

2024_porsche_992_gt3_r/gt3r.glb is the shipped car: Sketchfab's scene.gltf (40 MB over 37 files) compressed
to one 6.3 MB file. The originals are no longer in the tree; restore them from git
(git checkout 321a995 -- assets/models/2024_porsche_992_gt3_r) or re-download from Sketchfab. car.js finds wheels, steering, mirrors and paint by node/material name, so nothing is
joined, flattened or renamed. Node 20.11 needs CLI 4.1.1 with @gltf-transform/* and sharp pinned (overrides:
core/extensions/functions 4.1.1, sharp 0.33.5); newer CLIs need Node >= 20.12.

  gltf-transform dedup   scene.gltf s1.glb --materials false --meshes false --skins false
  gltf-transform resize  s1.glb s2.glb --width 2048 --height 2048   # only the 4K livery is affected
  gltf-transform webp    s2.glb s3.glb --quality 88
  gltf-transform meshopt s3.glb gt3r.glb --level high               # last: later steps would decode it

car.js registers MeshoptDecoder for this. The track (drift_race_track_free) is CC BY-ND and must never be
run through any of this.
