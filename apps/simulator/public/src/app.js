import { World } from './world.js';
import { inspectionView, SceneEvidence } from './inspection.js';

const $ = id => document.getElementById(id);
let state, world, evidence, offset = 0, busy = false, connected = false;
let selected = 0, actions = [], signature = '', lastAttempt = 0, hudVisible = true;
let photoLoaded = '', toastTimer;
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000);
}
async function api(path, body) {
  const response = await fetch('/api/' + path, {
    ...(body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {}),
    cache:'no-store', signal:AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function accept(next) {
  if (state && next.serverTime < state.serverTime) return;
  if (state && next.startedAt === state.startedAt && next.inspection.version < state.inspection.version) return;
  if (!state || state.inspection.step !== next.inspection.step || state.revision !== next.revision) selected = 0;
  if (!state || state.revision !== next.revision) world.setPlate(next.entry.licence);
  state = next; connected = true; offset = next.serverTime - Date.now();
  world.setInspection(state); render(); evidence.tick(state);
}
async function command(path, extra = {}) {
  if (busy || !state || !connected) return;
  busy = true; render();
  try { accept(await api(path, {revision:state.revision, inspectionVersion:state.inspection.version, ...extra})); }
  catch (e) {
    toast(e.message);
    try { accept(await api('state')); } catch { connected = false; }
  } finally { busy = false; render(); }
}
function render() {
  if (!state) return;
  const i = state.inspection, p = state.presentation, view = inspectionView(state);
  $('hud').hidden = !state.event || !hudVisible;
  $('licence').textContent = state.entry.licence;
  $('step-title').textContent = view.title;
  $('status-chip').textContent = view.status.toUpperCase();
  $('status-chip').className = 'status-chip ' + view.status;
  $('profile').textContent = p.direction + ' / ' + state.job.label;
  $('company').textContent = p.company;
  $('driver').textContent = p.driver;
  $('destination').textContent = p.destination;
  $('summary').hidden = i.step !== 'ready';
  $('details').hidden = !['trailer','seal'].includes(i.step);
  $('vehicle-model').textContent = p.vehicle;
  $('trailer').textContent = p.trailer;
  $('seal').textContent = i.expectedSeal + ' (demo plan)';
  $('lpr-device').textContent = p.checkpoint;
  $('decision-reason').textContent = connected ? view.detail : 'Connection lost. Inspection paused.';
  $('barrier-status').textContent = '● GATE CLOSED';
  $('evidence').hidden = !i.photo;
  if (i.photo && $('evidence-photo').getAttribute('src') !== i.photo.url) {
    photoLoaded = ''; $('evidence-photo').src = i.photo.url;
  }
  $('incident-id').hidden = !i.incident;
  $('incident-id').textContent = i.incident ? `${i.incident.id} · ${i.incident.status} · ${i.id}` : '';
  actions = view.actions;
  selected = Math.min(selected, Math.max(0,actions.length-1));
  const nextSignature = JSON.stringify([actions,selected,busy,connected,i.photo?.id,photoLoaded]);
  if (nextSignature !== signature) {
    signature = nextSignature; $('hud-actions').replaceChildren();
    for (const [index,[id,label]] of actions.entries()) {
      const button = document.createElement('button'); button.textContent = label;
      button.className = index === selected ? 'selected' : '';
      button.disabled = busy || !connected || (id === 'accept-photo' && photoLoaded !== i.photo?.url);
      button.addEventListener('click',() => { selected = index; activate(); });
      $('hud-actions').append(button);
    }
  }
  $('connection').textContent = connected ? 'Demo service online' : 'Service disconnected';
  $('objective').textContent = !state.event ? 'Look at the truck, or press E, to load the assignment' : view.title + (['seal','photo'].includes(i.step) ? ' · G: go to the seal' : '');
  for (const button of document.querySelectorAll('[data-scenario]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === state.scenario));
    button.disabled = busy || !connected;
  }
  renderAudit();
}
function renderAudit() {
  if ($('audit').hidden || !state) return;
  $('audit-list').replaceChildren();
  for (const item of [...state.audit].reverse()) {
    const li=document.createElement('li'), title=document.createElement('strong'), detail=document.createElement('span');
    title.textContent=item.action;detail.textContent=item.reason;li.append(title,detail);$('audit-list').append(li);
  }
}
async function activate() {
  if (busy || !connected || !hudVisible) return;
  const action = actions[selected]?.[0];
  if (!action || action === 'accept-photo' && photoLoaded !== state.inspection.photo?.url) return;
  await command('inspection/'+action, action === 'trailer' ? {confirmed:true} : {});
}
async function inspect() {
  if (!state || state.event || busy || !connected || !world.inspectable().visible) return;
  if (Date.now()+offset-state.startedAt < 4500) return;
  lastAttempt=Date.now(); await command('scan');
}
function menu(show) { $('menu').hidden=!show; $('menu-toggle').setAttribute('aria-expanded',String(show)); }
function toggleHud() {hudVisible=!hudVisible;$('hud-toggle').textContent=hudVisible?'Hide display':'Show display';render();}
async function enter() {try {await $('world').requestPointerLock();} catch {toast('Click Enter checkpoint again to capture the mouse.');}}
try {
  world=new World($('world'));
  evidence=new SceneEvidence(world,api,accept,toast);
  $('evidence-photo').addEventListener('load',()=>{photoLoaded=$('evidence-photo').getAttribute('src');render();});
  $('evidence-photo').addEventListener('error',()=>{photoLoaded='';toast('Photo unavailable. Retake the scene photo.');render();});
  $('walk').addEventListener('click',enter);
  $('world').addEventListener('click',()=>{if(!world.locked)enter();});
  $('menu-toggle').addEventListener('click',()=>{if(world.locked)document.exitPointerLock();else menu($('menu').hidden);});
  $('audit-toggle').addEventListener('click',()=>{$('audit').hidden=false;renderAudit();});
  $('audit-close').addEventListener('click',()=>$('audit').hidden=true);
  $('hud-toggle').addEventListener('click',toggleHud);
  for(const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click',()=>command('scenario',{scenario:button.dataset.scenario}));
  document.addEventListener('pointerlockchange',()=>{
    world.locked=document.pointerLockElement===$('world');world.keys.clear();
    document.body.classList.toggle('walking',world.locked);menu(!world.locked);
    if(world.locked){$('audit').hidden=true;document.activeElement?.blur();}
  });
  document.addEventListener('keydown',e=>{
    if(e.repeat)return;
    if(e.code==='Escape' && world.locked)document.exitPointerLock();
    if(e.code==='KeyR')world.resetView();
    if(e.code==='KeyG')world.sealView();
    if(e.code==='KeyE')inspect();
    if(e.code==='KeyH')toggleHud();
    const scenario={Digit1:'valid',Digit2:'mismatch',Digit3:'unreadable',Digit4:'missing',Digit5:'arrival',Digit6:'blocked'}[e.code];
    if(scenario)command('scenario',{scenario});
    if(e.code==='Enter' && document.activeElement?.tagName==='BUTTON' && !world.locked)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code) && actions.length && hudVisible){
      e.preventDefault();selected=(selected+(['ArrowRight','ArrowDown'].includes(e.code)?1:-1)+actions.length)%actions.length;render();
    }
    if(e.code==='Enter'){e.preventDefault();activate();}
  });
  let previous=performance.now();
  world.renderer.setAnimationLoop(now=>{
    const dt=Math.min((now-previous)/1000,.05);previous=now;
    world.update(dt,state,connected?Date.now()+offset:state?.serverTime||Date.now());
    const target=world.inspectable();$('target').hidden=!world.locked||!target.visible||Boolean(state?.event);
    $('distance').textContent=Math.round(target.distance)+' m';
    if(world.locked&&!state?.event&&Date.now()-lastAttempt>2000)inspect();
  });
  async function poll(){try{accept(await api('state'));}catch{connected=false;render();}setTimeout(poll,700);}
  poll();
  window.gateLensDiagnostics=()=>({locked:world.locked,position:{x:world.camera.position.x,z:world.camera.position.z},revision:state?.revision,scanned:Boolean(state?.event),step:state?.inspection.step,barrierAngle:world.arm.rotation.z,triangles:world.renderer.info.render.triangles});
} catch(e) {$('fatal-message').textContent=e.message;$('fatal').hidden=false;}
