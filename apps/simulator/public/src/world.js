import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { move, vehicleZ, barrierAngle, blocked } from './movement.js';

const palette = {
  teal: 0x66c3c1, asphalt: 0x44494b, concrete: 0xa7a8a2, steel: 0x444f53,
  white: 0xe7e6dc, dark: 0x222c30, glass: 0x496873, yellow: 0xe9c47a,
};

export class World {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb9cdd4);
    this.scene.fog = new THREE.Fog(0xc8d4d7, 40, 135);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.08, 170);
    this.camera.rotation.order = 'YXZ';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.add(new THREE.HemisphereLight(0xdceef8, 0x626859, 2.5));
    const sun = new THREE.DirectionalLight(0xffedd4, 3.6);
    sun.position.set(-22, 35, -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 40, bottom: -35, near: 1, far: 100 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
    this.colliders = [];
    this.materials = new Map();
    this.keys = new Set();
    this.locked = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.buildGround();
    this.buildBuildings();
    this.buildCheckpoint();
    this.buildLandscape();
    this.buildVan();
    this.batchStatic(this.scene);
    this.batchStatic(this.van);
    this.batchStatic(this.arm);
    this.resetView();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.002;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.002, -1.25, 1.25);
    });
    window.addEventListener('keydown', e => this.keys.add(e.code));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => this.keys.clear());
  }

  mat(color, roughness = 0.8, metalness = 0) {
    const key = `${color}/${roughness}/${metalness}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return this.materials.get(key);
  }

  batchStatic(parent) {
    const groups = new Map();
    for (const mesh of [...parent.children]) {
      if (!mesh.isMesh) continue;
      mesh.updateMatrix();
      const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
      if (!groups.has(mesh.material)) groups.set(mesh.material,[]);
      groups.get(mesh.material).push(geometry);
      parent.remove(mesh); mesh.geometry.dispose();
    }
    for (const [material,geometries] of groups) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error('Could not batch scene geometry');
      const mesh = new THREE.Mesh(merged,material);
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
  }

  box(x, y, z, w, h, d, color, parent = this.scene, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? this.mat(color) : color);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (solid) this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return mesh;
  }

  cylinder(x, y, z, r, height, color, parent = this.scene, rTop = r) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, height, 12), this.mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  roundedBox(x,y,z,w,h,d,material,parent,radius=0.12) {
    const mesh = this.box(x,y,z,w,h,d,material,parent);
    mesh.geometry.dispose(); mesh.geometry = new RoundedBoxGeometry(w,h,d,3,radius);
    return mesh;
  }

  label(text, x, y, z, w, h, { bg = '#263336', fg = '#f2f4f0', size = 58, flip = true, parent = this.scene } = {}) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = Math.max(64, Math.round(1024 * h / w));
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg; ctx.font = `600 ${size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2, c.width - 45);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }));
    m.position.set(x, y, z); m.rotation.y = flip ? Math.PI : 0;
    parent.add(m);
    return { mesh: m, texture, canvas: c };
  }

  buildGround() {
    // Deterministic procedural asphalt; no external textures or private assets.
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d'); const image = ctx.createImageData(256, 256);
    let seed = 23;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = 76 + seed % 24;
      image.data.set([n, n + 3, n + 4, 255], i);
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(c); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 30); texture.colorSpace = THREE.SRGBColorSpace;
    const road = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.98 });
    this.box(0, -0.14, 0, 160, 0.2, 160, 0x90977e);
    this.box(0, -0.02, 0, 12, 0.12, 100, road);
    this.box(-13, -0.03, 0, 14, 0.1, 64, palette.concrete);
    this.box(13, -0.03, 0, 14, 0.1, 64, palette.concrete);
    for (const x of [-5.5, 5.5]) {
      this.box(x, 0.045, 0, 0.1, 0.01, 90, palette.white);
      for (let z = -30; z < 31; z += 1) this.box(x * 1.14, 0.07, z, 0.24, 0.18, 0.95, z % 2 ? 0xc0c0b5 : 0x69726c);
    }
    for (let z = -40; z < 44; z += 4) this.box(0, 0.048, z, 0.13, 0.01, 1.9, palette.white);
    this.box(0, 0.055, 3.15, 5.4, 0.02, 0.38, palette.white);
    for (let x = -5; x < 6; x += 1.3) this.box(x, 0.055, -5.5, 0.7, 0.025, 2.4, 0xbabeb5);
    const stop = this.label('STOP', 0, 0.07, 5.2, 3.3, 1.1, { bg: '#4e5253', fg: '#e2e3d9', size: 200 });
    stop.mesh.rotation.set(-Math.PI / 2, 0, 0);
    for (const x of [-8, 8]) {
      for (let z = -20; z <= 25; z += 15) {
        this.cylinder(x, 3.5, z, 0.09, 7, 0x647073);
        this.box(x + (x < 0 ? 0.6 : -0.6), 6.95, z, 1.5, 0.1, 0.17, palette.steel);
        this.box(x + (x < 0 ? 1.2 : -1.2), 6.85, z, 0.65, 0.12, 0.3, palette.white);
      }
    }
  }

  buildBuildings() {
    // Guard house: teal fascia, window frames, door and air-conditioning details.
    this.box(-5.6, 1.55, 0.4, 3.6, 3.1, 5, 0xd2d2c7, this.scene, true);
    this.box(-5.6, 0.3, 0.4, 3.65, 0.6, 5.05, palette.steel);
    this.box(-5.6, 3.12, 0.4, 4.1, 0.22, 5.5, palette.dark);
    this.box(-5.6, 2.85, -2.13, 3.65, 0.36, 0.1, palette.teal);
    this.label('GATELENS   /   NORTH 01', -5.6, 2.85, -2.2, 3.2, 0.25, { bg: '#66c3c1', fg: '#183435', size: 57 });
    const glass = this.mat(palette.glass, 0.16, 0.55);
    this.box(-5.6, 1.8, -2.12, 2.85, 1.2, 0.08, glass);
    for (let x = -6.9; x < -4; x += 0.95) this.box(x, 1.8, -2.18, 0.055, 1.25, 0.04, palette.white);
    this.box(-3.77, 1.8, 0.6, 0.06, 1.2, 2.8, glass);
    for (let z = -0.8; z < 2.1; z += 1) this.box(-3.72, 1.8, z, 0.05, 1.24, 0.05, palette.white);
    this.box(-5.6, 0.6, -2.5, 3.4, 0.15, 0.55, palette.concrete);
    this.box(-7.45, 1.15, 0, 0.08, 2.2, 1, palette.steel);
    this.box(-7.55, 1.4, 1.6, 0.38, 0.8, 1, palette.white);
    for (let y = 1.1; y < 1.75; y += 0.1) this.box(-7.75, y, 1.6, 0.02, 0.025, 0.8, palette.steel);
    for (const [x, z, width, depth, height] of [[17, 10, 16, 30, 8], [-19, 18, 15, 18, 7], [16, -25, 20, 15, 10]]) {
      this.box(x, height / 2, z, width, height, depth, 0xa3b1b5, this.scene, true);
      this.box(x, 0.6, z, width + 0.1, 1.2, depth + 0.1, 0x67767b);
      this.box(x, height, z, width + 0.5, 0.3, depth + 0.5, 0x5a6c75);
      for (let dx = -width / 2 + 0.3; dx < width / 2; dx += 0.65) {
        this.box(x + dx, height / 2, z - depth / 2 - 0.02, 0.035, height - 0.5, 0.08, 0x8b9ca3);
      }
      for (let dz = -depth / 2 + 0.3; dz < depth / 2; dz += 0.65) this.box(x - width / 2 - 0.02, height / 2, z + dz, 0.08, height - 0.5, 0.035, 0x8b9ca3);
      this.box(x, height - 1.2, z - depth / 2 - 0.06, width - 1.2, 0.9, 0.05, glass);
      for (const dx of [-width / 4, width / 4]) {
        this.box(x + dx, 2.1, z - depth / 2 - 0.08, 3.7, 4.2, 0.12, 0x4f636c);
        for (let y = 0.2; y < 4.1; y += 0.25) this.box(x + dx, y, z - depth / 2 - 0.16, 3.65, 0.025, 0.03, 0x7b8d95);
      }
    }
    this.label('CEDAR   /   LOGISTICS', 17, 5.9, -5.2, 10, 0.75, { size: 65 });
    this.label('02   DISTRIBUTION', -19, 4.9, 8.85, 9, 0.65, { size: 65 });
  }

  buildCheckpoint() {
    // Boom pivot at the road edge, with a ground-plane collider added dynamically.
    this.box(-2.95, 0.66, 0, 0.64, 1.32, 0.7, palette.white, this.scene, true);
    this.box(-2.95, 1.33, 0, 0.7, 0.12, 0.76, palette.dark);
    this.box(-2.95, 0.75, -0.36, 0.3, 0.65, 0.025, palette.teal);
    this.arm = new THREE.Group(); this.arm.position.set(-2.95, 1.12, 0); this.scene.add(this.arm);
    this.box(3, 0, 0, 6, 0.17, 0.14, palette.white, this.arm);
    for (let x = 0.3; x < 6; x += 0.6) this.box(x, 0, 0, 0.28, 0.18, 0.15, 0xc54f44, this.arm);
    this.cylinder(3.15, 0.55, 0, 0.08, 1.1, palette.steel);
    // Signal and LPR pole.
    this.cylinder(3.8, 1.6, 1.1, 0.07, 3.2, palette.steel);
    this.box(3.8, 2.45, 1.1, 0.38, 1, 0.35, palette.dark);
    this.redSignal = new THREE.MeshStandardMaterial({ color: 0xe66b55, emissive: 0xe34f3c, emissiveIntensity: 1.3 });
    this.greenSignal = new THREE.MeshStandardMaterial({ color: 0x18392e, emissive: 0x42dca0, emissiveIntensity: 0 });
    this.box(3.8, 2.7, 1.29, 0.24, 0.24, 0.04, this.redSignal);
    this.box(3.8, 2.2, 1.29, 0.24, 0.24, 0.04, this.greenSignal);
    this.box(3.8, 2.7, 0.91, 0.16, 0.16, 0.04, this.redSignal);
    this.box(3.8, 2.2, 0.91, 0.16, 0.16, 0.04, this.greenSignal);
    this.box(3.8, 3.1, 1.35, 0.45, 0.25, 0.6, palette.white);
    this.box(3.8, 3.1, 1.66, 0.3, 0.16, 0.02, palette.dark);
    this.label('LPR 01', 3.8, 1.4, 0.9, 0.75, 0.25, { size: 170 });
    for (const x of [-3.6, 3.5]) for (const z of [-1.6, 2.2]) {
      this.cylinder(x, 0.5, z, 0.12, 1, palette.yellow);
      this.cylinder(x, 0.65, z, 0.125, 0.2, palette.dark);
      this.colliders.push({ minX:x-0.13, maxX:x+0.13, minZ:z-0.13,maxZ:z+0.13 });
    }
    for (const [from, to] of [[-28, -8], [6.8, 32]]) {
      this.box((from + to) / 2, 0.28, 0, to - from, 0.55, 0.22, palette.concrete, this.scene, true);
      for (let x = from; x <= to; x += 2) {
        this.cylinder(x, 1.45, 0, 0.045, 2.9, palette.steel);
        for (let dx = 0.15; dx < 2; dx += 0.2) this.box(x + dx, 1.7, 0, 0.014, 2.3, 0.014, 0x7f9194);
      }
      for (const y of [0.7, 1.5, 2.5]) this.box((from + to) / 2, y, 0, to - from, 0.028, 0.028, 0x7f9194);
    }
    for (const x of [-9, 8]) {
      this.box(x, 0.23, -3.2, 1.8, 0.46, 0.7, 0x9f9e92, this.scene, true);
      this.box(x, 0.48, -3.2, 1.65, 0.09, 0.55, 0x4c5b4c);
      for (let i = 0; i < 5; i++) this.cylinder(x - 0.65 + i * 0.32, 0.8, -3.2, 0.2, 0.65, 0x567c68, this.scene, 0.07);
    }
    this.cylinder(5.2, 1.1, 4, 0.05, 2.2, palette.steel);
    this.label('10', 5.2, 2.05, 3.95, 0.7, 0.75, { bg:'#e9e7db',fg:'#33454a',size:320 });
  }

  buildLandscape() {
    for (let i = 0; i < 22; i++) {
      const x = i % 2 ? -29 - (i % 4) * 2 : 30 + (i % 3) * 3;
      const z = -30 + i * 3.5;
      const h = 4 + (i % 4);
      this.cylinder(x, h / 2, z, 0.22, h, 0x6d6653);
      for (let j = 0; j < 3; j++) {
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 - j * 0.35, 1), this.mat(j % 2 ? 0x647d60 : 0x6e8669));
        leaves.position.set(x + Math.sin(i + j) * 0.7, h + j * 0.9, z); leaves.castShadow = true; this.scene.add(leaves);
      }
    }
    // Freight containers and roof equipment provide depth without external models.
    for (const [x,z,color] of [[-13,-18,0x6c8c8d],[-14,-25,0x9e7660],[12,30,0x6d828b]]) {
      this.box(x, 1.3, z, 2.7, 2.6, 6.4, color, this.scene, true);
      for (let dz = -3; dz < 3; dz += 0.28) this.box(x + 1.36, 1.3, z + dz, 0.05, 2.4, 0.06, color);
    }
    for (let i = 0; i < 8; i++) {
      const x = 11 + i * 2.4;
      this.box(x, 8.6, 12, 1, 1.3, 1.7, 0xced1cb);
    }
  }

  buildVan() {
    // Tractor + box trailer, built from local geometry. No third-party assets.
    this.van = new THREE.Group(); this.scene.add(this.van);
    const body = this.mat(0x66a6a4, .4, .15);
    const glass = this.mat(0x395965, .18, .2);
    this.box(0,.65,1.7,2.3,.35,10.3,palette.dark,this.van);
    this.roundedBox(0,1.8,-1.25,2.35,2.55,2.3,body,this.van);
    this.box(0,2.2,-2.42,2.02,.85,.05,glass,this.van);
    this.box(0,1,-2.44,1.6,.4,.04,palette.dark,this.van);
    this.box(0,.72,-2.48,2.4,.22,.12,palette.white,this.van);
    this.box(0,2.3,3.6,2.6,2.9,6.8,palette.white,this.van);
    this.box(0,.95,3.6,2.64,.14,6.85,palette.teal,this.van);
    for(const side of [-1,1]) {
      this.box(side*1.19,2.2,-1.3,.04,.7,1.45,glass,this.van);
      this.box(side*1.37,1.95,-2,.22,.4,.14,palette.dark,this.van);
      for(const z of [-1.4,.9,5.3,6.2]) {
        const wheel=this.cylinder(side*1.17,.57,z,.55,.32,0x202629,this.van);wheel.rotation.z=Math.PI/2;
        const hub=this.cylinder(side*1.35,.57,z,.29,.03,0xa6b5b6,this.van);hub.rotation.z=Math.PI/2;
      }
      for(let z=.4;z<6.9;z+=.5) this.box(side*1.31,2.3,z,.025,2.7,.04,0xb8c8c8,this.van);
    }
    // Rear doors, locking bars and an inspectable seal tag.
    this.box(0,2.3,7.04,.035,2.85,.04,palette.dark,this.van);
    for(const x of [-.7,.7]) this.box(x,2.25,7.07,.045,2.5,.06,palette.steel,this.van);
    this.box(.15,1.8,7.13,.18,.35,.08,palette.steel,this.van);
    this.plate=this.label('HZ27KLGP',0,.72,-2.56,1,.23,{bg:'#eceee8',fg:'#233136',size:145,parent:this.van});
    this.sealLabel=this.label('',0,1.43,7.19,1.2,.5,{bg:'#ffe0a2',fg:'#253534',size:120,parent:this.van,flip:false});
    this.trailerPlate=this.label('KT18NBGP',0,.85,7.16,1.1,.24,{bg:'#eceee8',fg:'#233136',size:130,parent:this.van,flip:false});
    this.label('CEDAR / DISPATCH',0,3.2,7.09,2.2,.32,{bg:'#294644',fg:'#b4e6e4',size:90,parent:this.van,flip:false});
    this.van.position.z=28;
  }

  setInspection(state) {
    // Scene fixture paints the physical object only. The recognizer gets PNG pixels.
    const job=state.job, signature=JSON.stringify(job);
    if(!job || this.jobSignature===signature)return;
    this.jobSignature=signature;
    const {canvas,texture}=this.sealLabel,ctx=canvas.getContext('2d');
    ctx.fillStyle=job.condition==='missing'?'#e7e6dc':'#ffd35a';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(job.condition!=='missing'){
      ctx.fillStyle='#172221';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='bold 100px Arial';ctx.fillText('SEAL',512,100);
      ctx.font='bold 145px Arial';ctx.fillText(job.sceneSeal,512,280,960);
      if(job.condition==='damaged'){
        ctx.fillStyle='#3e4c49';ctx.fillRect(190,200,650,150);
        ctx.strokeStyle='#e1dac0';ctx.lineWidth=18;ctx.beginPath();ctx.moveTo(130,150);ctx.lineTo(890,370);ctx.stroke();
      }
    }
    texture.needsUpdate=true;
    const plate=this.trailerPlate,pc=plate.canvas.getContext('2d');
    pc.fillStyle='#eceee8';pc.fillRect(0,0,plate.canvas.width,plate.canvas.height);
    pc.fillStyle='#233136';pc.font='600 130px Arial';pc.textAlign='center';pc.textBaseline='middle';
    pc.fillText(job.trailer,512,plate.canvas.height/2,950);plate.texture.needsUpdate=true;
  }

  sealView() {
    this.camera.position.set(0,1.72,this.van.position.z+9.4);
    this.camera.lookAt(0,1.43,this.van.position.z+7.19);
    this.yaw=this.camera.rotation.y;this.pitch=this.camera.rotation.x;this.keys.clear();
  }

  captureView() {
    // Render the operator's current camera, never move to a presumed target.
    // Synchronize input before capture even between throttled animation frames.
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    this.renderer.render(this.scene,this.camera);
    const photo=document.createElement('canvas');photo.width=1280;photo.height=720;
    const ctx=photo.getContext('2d');
    const source=this.renderer.domElement;
    // Keep the complete field of view without stretching or cropping it.
    const scale=Math.min(1280/source.width,696/source.height);
    const width=source.width*scale,height=source.height*scale;
    ctx.fillStyle='#142323';ctx.fillRect(0,0,1280,720);
    ctx.drawImage(source,(1280-width)/2,(696-height)/2,width,height);
    ctx.fillStyle='#b4e6e4';ctx.font='16px Arial';
    ctx.fillText('GateLens · Current 3D view · Check framing before accepting',12,714);
    return photo.toDataURL('image/png');
  }

  setPlate(plate) {
    const ctx = this.plate.canvas.getContext('2d');
    ctx.fillStyle = '#eceee8'; ctx.fillRect(0,0,this.plate.canvas.width,this.plate.canvas.height);
    ctx.fillStyle = '#233136'; ctx.font = '600 145px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(plate,512,this.plate.canvas.height/2,950); this.plate.texture.needsUpdate = true;
  }

  resetView() {
    this.camera.position.set(4.9, 1.72, -6.2);
    this.camera.lookAt(0, 1.3, 4);
    this.yaw = this.camera.rotation.y; this.pitch = this.camera.rotation.x;
    this.keys.clear();
  }

  resize() {
    this.renderer.setSize(innerWidth,innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt, state, now) {
    const carZ = state ? vehicleZ(now,state.startedAt,state.openedAt) : 28;
    this.van.position.z = Math.max(-40,carZ);
    const angle = state ? barrierAngle(now,state.openedAt) : 0;
    this.arm.rotation.z = angle;
    this.greenSignal.emissiveIntensity = angle > 1.3 ? 1.5 : 0;
    this.redSignal.emissiveIntensity = angle > 1.3 ? 0 : 1.3;
    const boxes = [...this.colliders];
    if (carZ > -32) boxes.push({ minX:-1.4,maxX:1.4,minZ:carZ-2.6,maxZ:carZ+7.3 });
    if (angle < 1.25) boxes.push({ minX:-2.95,maxX:3.05,minZ:-0.12,maxZ:0.12 });
    // Moving vehicles yield to a pedestrian by gently displacing them to the lane edge.
    // This demo is not a physics or safety-system model.
    if (blocked(this.camera.position.x,this.camera.position.z,boxes) && Math.abs(this.camera.position.x) < 1.6 && this.camera.position.z > carZ-2.95 && this.camera.position.z < carZ+7.65) {
      this.camera.position.x = this.camera.position.x < 0 ? -1.7 : 1.7;
    }
    if (this.locked) {
      let forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
      let side = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      const length = Math.hypot(forward,side);
      if (length) {
        const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4.5 : 2.6) * dt;
        forward /= length; side /= length;
        const dx = (-Math.sin(this.yaw)*forward + Math.cos(this.yaw)*side)*speed;
        const dz = (-Math.cos(this.yaw)*forward - Math.sin(this.yaw)*side)*speed;
        const next = move(this.camera.position,dx,dz,boxes);
        this.camera.position.x = next.x; this.camera.position.z = next.z;
        this.bob += dt * 9;
      }
      this.camera.position.y = 1.72 + (length ? Math.sin(this.bob) * 0.025 : 0);
    }
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    // Leave CPU headroom for the Android emulator and the native SDK renderer.
    if (!this.lastFrame || performance.now()-this.lastFrame >= 1000/24) {
      this.lastFrame=performance.now();
      this.renderer.render(this.scene,this.camera);
    }
  }

  inspectable() {
    const toCar = new THREE.Vector3(0,1.4,this.van.position.z).sub(this.camera.position);
    const distance = toCar.length();
    const facing = this.camera.getWorldDirection(new THREE.Vector3()).dot(toCar.normalize());
    return { distance, visible: distance < 18 && facing > 0.78 };
  }
}
