import { World } from './world.js';
import { SceneEvidence, inspectionView } from './inspection.js';

// The official DAT document owns #app, focus, D-pad and click callbacks.
// Only our environment is appended outside body (the extension's display surface).
const root = document.documentElement;
const canvas = document.createElement('canvas'); canvas.id = 'gatelens-world';
const controls = document.createElement('section'); controls.id = 'gatelens-controls';
const walk = document.createElement('button'); walk.textContent = 'Walk in checkpoint';
const help = document.createElement('span'); help.textContent = 'WASD · Mouse · G: seal view · Esc: release cursor';
const status = document.createElement('small'); status.textContent = 'Connecting to checkpoint…';
const hint = document.createElement('small'); hint.textContent = '1: match / 2: wrong / 3: damaged / 4: missing / 5: arrival / 6: blocked · Arrows + Enter: official Meta display';
controls.append(walk,help,status,hint); root.append(canvas,controls);
const reticle = document.createElement('div'); reticle.id = 'gatelens-reticle'; root.append(reticle);
let world, evidence;
let state = null;
let connected = false;
let offset = 0;
let pending = false;
let lastAttempt = 0;
async function api(path,body) {
 const res = await fetch('/api/'+path,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)} : {cache:'no-store',signal:AbortSignal.timeout(3000)});
 const data = await res.json(); if(!res.ok) throw new Error(data.error); return data;
}
function accept(data) {
 if(state && data.serverTime<state.serverTime)return;
 if(state && data.startedAt===state.startedAt && data.inspection.version<state.inspection.version)return;
 if(state?.revision !== data.revision || state?.startedAt !== data.startedAt) world.setPlate(data.entry.licence);
 state=data;offset=data.serverTime-Date.now();connected=true;
 world.setInspection(data);
 status.textContent = data.event ? `${data.entry.licence} · ${inspectionView(data).title} · 3D evidence` : 'Look at the truck to load the inspection assignment.';
 evidence.tick(data);
}
async function command(path,body) {
 if(pending || !connected)return;pending=true;
 try{accept(await api(path,body));}catch(e){status.textContent=e.message;}finally{pending=false;}
}
try {
 world = new World(canvas);
 evidence = new SceneEvidence(world,api,accept,message=>status.textContent=message);
 const originalResize = world.resize.bind(world);
 world.resize = () => {
  if (!root.classList.contains('mdcs-active')) { originalResize(); return; }
  // The extension rewrites viewport units to 600px for app CSS. Use actual
  // stage pixels for the environment, which lives outside the display body.
  const screen = root.getBoundingClientRect();
  const sidebar = parseFloat(getComputedStyle(root).getPropertyValue('--mdcs-sidebar-w')) || 344;
  const width = Math.max(1,screen.width-sidebar), height = Math.max(1,screen.height-76);
  canvas.style.setProperty('width',`${width}px`,'important');
  canvas.style.setProperty('height',`${height}px`,'important');
  reticle.style.left=`${sidebar+width/2}px`;reticle.style.top=`${76+height/2}px`;
  world.renderer.setSize(width,height,false);
  world.camera.aspect = width/height; world.camera.updateProjectionMatrix();
 };
 new ResizeObserver(()=>world.resize()).observe(canvas);
 walk.addEventListener('click',async()=>{
  try {await canvas.requestPointerLock();walk.blur();}catch{status.textContent='Click Walk again to allow mouse capture.';}
 });
 document.addEventListener('pointerlockchange',()=>{
  world.locked=document.pointerLockElement===canvas;world.keys.clear();root.classList.toggle('gatelens-walking',world.locked);
  walk.textContent=world.locked?'Walking · Esc to pause':'Walk in checkpoint';
 });
 window.addEventListener('keydown',e=>{
  if(e.repeat)return;
  if(e.code==='Escape'&&world.locked)document.exitPointerLock();
  if(e.code==='KeyR')world.resetView();
  if(e.code==='KeyG')world.sealView();
  const scenario={Digit1:'valid',Digit2:'mismatch',Digit3:'unreadable',Digit4:'missing',Digit5:'arrival',Digit6:'blocked'}[e.code];
  if(scenario)command('scenario',{scenario});
 });
 new MutationObserver(()=>{
  if(!root.classList.contains('mdcs-active')&&world.locked)document.exitPointerLock();
 }).observe(root,{attributes:true,attributeFilter:['class']});
 let previous=performance.now();
 world.renderer.setAnimationLoop(now=>{
  const dt=Math.min((now-previous)/1000,.05);previous=now;
  if(!root.classList.contains('mdcs-active'))return;
  const clock=connected?Date.now()+offset:state?.serverTime||Date.now();
  world.update(dt,state,clock);
  if(world.locked&&connected&&state&&!state.event&&!pending&&world.inspectable().visible&&clock-state.startedAt>=4500&&Date.now()-lastAttempt>2000){
   lastAttempt=Date.now();command('scan',{revision:state.revision});
  }
 });
 async function poll(){try{accept(await api('state'));}catch{connected=false;status.textContent='Checkpoint offline. Display actions must wait for reconnection.';}setTimeout(poll,650);}
 poll();
 window.gateLensDiagnostics=()=>({locked:world.locked,position:{x:world.camera.position.x,z:world.camera.position.z},decision:state?.decision,barrierAngle:world.arm.rotation.z,revision:state?.revision,scanned:Boolean(state?.event),step:state?.inspection.step});
}catch(e){status.textContent='3D failed: '+e.message;}
