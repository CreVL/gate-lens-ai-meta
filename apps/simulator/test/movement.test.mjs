import test from 'node:test';
import assert from 'node:assert/strict';
import {move,blocked,vehicleZ,barrierAngle} from '../public/src/movement.js';

test('a long step cannot tunnel through a closed barrier',() => {
  const wall = {minX:-3,maxX:3,minZ:-.12,maxZ:.12};
  const p = move({x:0,z:-3},0,12,[wall]);
  assert.ok(p.z < -.43 && p.z > -.6);
  assert.equal(blocked(p.x,p.z,[wall]),false);
});
test('walk slides along the side of a building',() => {
  const wall = {minX:1,maxX:4,minZ:-5,maxZ:5};
  const p = move({x:0,z:-2},4,4,[wall]);
  assert.ok(p.x < .69);
  assert.ok(p.z > 1.9);
});
test('cleared barrier permits movement and world bounds stop escape',() => {
  assert.ok(Math.abs(move({x:0,z:-1},0,3,[]).z - 2) < 0.0001);
  assert.ok(move({x:24,z:0},10,0,[]).x <= 25);
});
test('vehicle waits for authorization; boom clears before vehicle enters',() => {
  assert.equal(vehicleZ(9000,1000,0),6);
  assert.equal(vehicleZ(11000,1000,10000),6);
  assert.ok(barrierAngle(11600,10000) > 1.4);
  assert.ok(vehicleZ(13000,1000,10000) < 2);
  assert.equal(barrierAngle(23000,10000),0);
});
