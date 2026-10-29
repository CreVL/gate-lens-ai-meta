// Pixel-only local recognizer. No task, expected number or 3D scene metadata.
import {createWorker, PSM} from 'tesseract.js';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);

export function labelRegions(image) {
 const {width:w,height:h,data}=image,mask=new Uint8Array(w*h),seen=new Uint8Array(w*h),regions=[];
 for(let y=0;y<h-24;y++)for(let x=0;x<w;x++){
  const k=y*w+x,j=k*4,r=data[j],g=data[j+1],b=data[j+2];
  // Detector for the known yellow security-label design in this simulator.
  mask[k]=r>85 && g>65 && r>b*1.4 && g>b*1.22 && r>=g*.94 ? 1:0;
 }
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||seen[start])continue;
  const queue=[start];seen[start]=1;
  let left=w,right=0,top=h,bottom=0;
  for(let n=0;n<queue.length;n++){
   const k=queue[n],x=k%w,y=Math.floor(k/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   for(const next of [x>0?k-1:-1,x<w-1?k+1:-1,k-w,k+w])if(next>=0&&next<mask.length&&mask[next]&&!seen[next]){seen[next]=1;queue.push(next);}
  }
  const width=right-left+1,height=bottom-top+1,ratio=width/height,fill=queue.length/(width*height);
  if(width>=45&&height>=14&&ratio>=1.7&&ratio<=7&&fill>.5&&width<w*.8&&height<h*.5)regions.push({left,top,width,height,fill});
 }
 return regions.sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,3);
}
function cropForOCR(image,box){
 const scale=4,pad=24,result=new PNG({width:box.width*scale+pad*2,height:box.height*scale+pad*2});result.data.fill(255);
 let sum=0;
 for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){const j=((box.top+y)*image.width+box.left+x)*4;sum+=(image.data[j]+image.data[j+1]+image.data[j+2])/3;}
 const threshold=sum/(box.width*box.height)*.68;
 for(let y=0;y<box.height*scale;y++)for(let x=0;x<box.width*scale;x++){
  const src=((box.top+Math.floor(y/scale))*image.width+box.left+Math.floor(x/scale))*4;
  const gray=(image.data[src]+image.data[src+1]+image.data[src+2])/3<threshold?0:255;
  const dest=((y+pad)*result.width+x+pad)*4;result.data[dest]=result.data[dest+1]=result.data[dest+2]=gray;
 }
 return PNG.sync.write(result);
}
export async function recognizeSeal(bytes){
 const image=PNG.sync.read(bytes,{checkCRC:true});
 if(image.width>1280||image.height>960)throw new Error('Image too large');
 const imageSha256=createHash('sha256').update(bytes).digest('hex');
 const base={imageSha256,engine:'tesseract.js-7',detector:'yellow-seal-label-v1',number:'',confidence:0,present:false};
 const regions=labelRegions(image);
 if(!regions.length)return {...base,status:'no_seal',reason:'No readable seal label in frame. Move closer and aim at the seal.'};
 const langPath=join(dirname(require.resolve('@tesseract.js-data/eng/package.json')),'4.0.0');
 const worker=await createWorker('eng',1,{langPath,cacheMethod:'none',logger:()=>{}}, {load_system_dawg:'0',load_freq_dawg:'0'});
 try{
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',preserve_interword_spaces:'1'});
  const found=[];let best=null;
  for(const box of regions){
   const {data}=await worker.recognize(cropForOCR(image,box),{}, {text:true,blocks:true});
   const text=data.text.toUpperCase();
   const numbers=[...new Set(text.match(/\b[A-Z]{2}-\d{5}\b/g)||[])];
   const present=/\bSEAL\b/.test(text);
   const result={...base,present,confidence:data.confidence,box,rawText:text.trim().slice(0,120)};
   if(present&&numbers.length===1&&data.confidence>=70)found.push({...result,status:'readable',number:numbers[0],reason:'Seal label and number read from the photograph.'});
   if(!best||data.confidence>best.confidence)best=result;
  }
  if(found.length===1)return found[0];
  if(found.length>1)return {...base,status:'unreadable',present:true,reason:'Several seal labels are visible. Frame one seal at a time.'};
  return {...best,status:'unreadable',number:'',reason:'Label is too small, damaged or uncertain. Retake a closer, straight-on photograph.'};
 }finally{await worker.terminate();}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>2200000)throw new Error('Input too large');}
  const {image}=JSON.parse(input);
  const result=await recognizeSeal(Buffer.from(image,'base64'));
  process.stdout.write(JSON.stringify(result));
 }catch(e){process.stderr.write(String(e.message));process.exitCode=1;}
}
