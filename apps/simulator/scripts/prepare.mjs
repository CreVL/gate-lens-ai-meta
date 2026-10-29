import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) {
  await copyFile(new URL(`../node_modules/three/build/${file}`, import.meta.url), new URL(file, target));
}
await copyFile(new URL('../node_modules/three/LICENSE', import.meta.url), new URL('THREE-LICENSE.txt', target));
// Rewrite only the package import so the official helper runs without a bundler/import map.
const utils = await readFile(new URL('../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url),'utf8');
await writeFile(new URL('BufferGeometryUtils.js',target),utils.replace("from 'three'","from './three.module.js'"));
const rounded = await readFile(new URL('../node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js',import.meta.url),'utf8');
await writeFile(new URL('RoundedBoxGeometry.js',target),rounded.replace("from 'three'","from './three.module.js'"));
console.log('Local Three.js assets ready. No CDN required at runtime.');
