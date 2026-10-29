import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {recognizeSeal} from '../scripts/seal-vision.mjs';
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 async function photo(number,{yellow=true,seal=true,damage=false}={}){
  return Buffer.from(await page.evaluate(({number,yellow,seal,damage})=>{
   const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');
   x.fillStyle='#82918d';x.fillRect(0,0,640,360);x.fillStyle=yellow?'#ffd35a':'#eee';x.fillRect(120,90,400,150);
   x.fillStyle='#172221';x.textAlign='center';x.font='bold 38px Arial';x.fillText(seal?'SEAL':'TRUCK',320,140);
   x.font='bold 48px Arial';x.fillText(number,320,207);
   if(damage){x.fillStyle='#434b49';x.fillRect(160,155,320,65);}
   return c.toDataURL('image/png').split(',')[1];
  },{number,yellow,seal,damage}),'base64');
 }
 // These numbers do not occur in the scenario catalogue. OCR has no reference input.
 for(const number of ['QZ-86740','LM-15273']){
  const r=await recognizeSeal(await photo(number));console.log(number,r);
  assert.equal(r.status,'readable');assert.equal(r.number,number);
 }
 for(const options of [{yellow:false},{seal:false},{damage:true}]){
  const r=await recognizeSeal(await photo('QZ-86740',options));console.log('reject',options,r.status);
  assert.notEqual(r.status,'readable');assert.equal(r.number,'');
 }
 console.log('PASS pixel-only OCR: unseen numbers, non-seal surfaces, damaged text');
}finally{await browser.close();}
