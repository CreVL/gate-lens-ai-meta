import {chromium} from 'playwright';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const base=process.env.GATELENS_TEST_URL||'http://127.0.0.1:9010';
const extension=process.env.META_EXTENSION_PATH;
if(!extension)throw new Error('META_EXTENSION_PATH required');
const output=fileURLToPath(new URL('../../../.artifacts/truck-check/',import.meta.url));
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'gatelens-check-truck-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1560,height:1000},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const page=await context.newPage();
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
await worker.evaluate(async origin=>chrome.storage.local.set({mdcs_enabled_origins:{[origin]:true}}),base);
const read=async()=>await(await page.request.get(base+'/api/state')).json();
try {
 await page.goto(base+'/glasses');
 await page.waitForFunction(()=>document.documentElement.classList.contains('mdcs-active'));
 for(const scenario of ['valid','blocked']){
  const reset=await(await page.request.post(base+'/api/scenario',{data:{scenario}})).json();
  await page.waitForFunction(rev=>window.gateLensDiagnostics?.().revision===rev,reset.revision);
  assert.equal(await page.evaluate(()=>window.gateLensDiagnostics().locked),false);
  // Wait for the new scenario's native card, not the previous job's still-visible button.
  await page.getByText('Truck approaching',{exact:true}).waitFor({timeout:30000});
  const check=page.getByRole('button',{name:'Check for truck',exact:true});
  await check.waitFor({timeout:30000});
  await page.waitForTimeout(750);
  assert.equal((await read()).event,null);
  await check.click();
  if(scenario==='valid'){
   const start=page.getByRole('button',{name:'Start inspection',exact:true});
   await start.waitFor({timeout:30000});
   await page.waitForTimeout(750);await start.click();
   await page.getByRole('button',{name:'Trailer confirmed',exact:true}).waitFor({timeout:30000});
   assert.equal((await read()).inspection.step,'trailer');
  }else{
   await page.getByText('Inspection unavailable.',{exact:false}).waitFor({timeout:30000});
   assert.equal(await page.getByRole('button',{name:'Start inspection',exact:true}).count(),0);
  }
  const state=await read();assert.ok(state.event);assert.equal(state.openedAt,0);
  await page.screenshot({path:join(output,scenario+'.png')});
  console.log('PASS official Check for truck without walking:',scenario);
 }
}finally{
 await page.request.post(base+'/api/scenario',{data:{scenario:'valid'}});
 await context.close();
}
