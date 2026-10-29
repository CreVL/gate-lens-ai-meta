import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
export async function verifyVision(meta=false){
 const base=process.env.GATELENS_TEST_URL||'http://127.0.0.1:9010';
 const extension=process.env.META_EXTENSION_PATH;
 if(meta&&!extension)throw new Error('META_EXTENSION_PATH is required');
 const output=fileURLToPath(new URL('../../../.artifacts/vision/',import.meta.url));await mkdir(output,{recursive:true});
 const profile=await mkdtemp(join(tmpdir(),'gatelens-vision-'));
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1560,height:1000},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(meta?[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]:[])]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const read=async()=>await(await page.request.get(base+'/api/state')).json();
 const waitState=async predicate=>{const until=Date.now()+60000;while(Date.now()<until){const s=await read();if(predicate(s))return s;await page.waitForTimeout(300);}throw new Error('State wait timeout: '+JSON.stringify((await read()).inspection));};
 const button=name=>page.getByRole('button',{name,exact:true});
 const click=async name=>{await button(name).waitFor({timeout:30000});if(meta)await page.waitForTimeout(750);await button(name).click();};
 const shot=async(scenario,suffix)=>page.screenshot({path:join(output,`${meta?'meta':'web'}-${scenario}-${suffix}.png`)});
 try{
  if(meta){const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(async origin=>chrome.storage.local.set({mdcs_enabled_origins:{[origin]:true}}),base);}
  await page.goto(base+(meta?'/glasses':''));
  if(meta)await page.waitForFunction(()=>document.documentElement.classList.contains('mdcs-active'));
  for(const scenario of (meta?['valid','mismatch','arrival','unreadable']:['valid','mismatch','unreadable','missing','arrival','blocked'])){
   const reset=await(await page.request.post(base+'/api/scenario',{data:{scenario}})).json();
   await page.waitForFunction(rev=>window.gateLensDiagnostics?.().revision===rev&&!window.gateLensDiagnostics().scanned,reset.revision,{timeout:30000});
   console.log('START',meta?'Meta':'web',scenario);
   if(meta)await click('Walk in checkpoint');else await page.locator('#walk').click();
   await page.waitForFunction(()=>window.gateLensDiagnostics().locked);await page.keyboard.press('KeyR');
   await page.waitForFunction(()=>window.gateLensDiagnostics().scanned,null,{timeout:30000});
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.gateLensDiagnostics().locked);
   if(!meta)await page.locator('#menu-toggle').click();
   if(scenario==='blocked'){
    await page.waitForTimeout(1000);assert.equal(await button('Start inspection').count(),0);
   }else{
    await click('Start inspection');await click('Trailer confirmed');
    let previousPhoto=null;
    if(scenario==='valid'){
     // Front view has a cab/plate, not a seal. It must not inherit the expected number.
     await page.keyboard.press('KeyR');await click('Capture and read seal');
     const bad=await waitState(s=>s.inspection.step==='photo_review');
     previousPhoto=bad.inspection.photo.id;
     assert.notEqual(bad.inspection.assessment.status,'readable');assert.equal(bad.inspection.observedSeal,'');
     await button('Report for review').waitFor({timeout:30000});await shot(scenario,'wrong-frame');
     await page.keyboard.press('KeyG');await click('Retake');
    }else{await page.keyboard.press('KeyG');await click('Capture and read seal');}
    const readState=await waitState(s=>s.inspection.step==='photo_review'&&s.inspection.photo.id!==previousPhoto);const i=readState.inspection;
    console.log('OCR',scenario,JSON.stringify(i.assessment));
    const photo=await page.request.get(base+i.photo.url);await writeFile(join(output,`${meta?'meta':'web'}-${scenario}-evidence.png`),await photo.body());
    if(['valid','mismatch','arrival'].includes(scenario)){
     assert.equal(i.assessment.status,'readable');assert.equal(i.observedSeal,readState.job.sceneSeal);
     await button('Accept read number').waitFor({timeout:30000});await shot(scenario,'read');
     await click('Accept read number');await click(scenario==='mismatch'?'Create incident':'Save inspection');
     const saved=await waitState(s=>['complete','incident'].includes(s.inspection.step));
     assert.equal(saved.inspection.step,scenario==='mismatch'?'incident':'complete');
     if(scenario==='arrival'){assert.equal(saved.inspection.expectedSeal,'');assert.equal(saved.inspection.sealMatches,false);}
    }else{
     assert.notEqual(i.assessment.status,'readable');assert.equal(i.observedSeal,'');
     await button('Report for review').waitFor({timeout:30000});assert.equal(await button('Accept read number').count(),0);
     await shot(scenario,'unreadable');await click('Report for review');await click('Create review incident');
     const saved=await waitState(s=>s.inspection.step==='incident');assert.equal(saved.inspection.incident.type,'Inspection review');
    }
    assert.equal((await read()).openedAt,0);await page.waitForTimeout(900);await shot(scenario,'result');
   }
   if(!meta)await page.locator('#menu-toggle').click();
   console.log('PASS',meta?'Meta':'web',scenario);
  }
  assert.deepEqual(errors,[]);
 }catch(e){await shot('failure','screen');throw e;}finally{await context.close();}
}
