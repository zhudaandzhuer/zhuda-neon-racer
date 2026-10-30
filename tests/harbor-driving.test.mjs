import test from 'node:test';
import assert from 'node:assert/strict';
import {HarborVehicle,harborHeight,harborDriveable,cameraObstruction} from '../.test-build.mjs';
const input = (throttle=0,steer=0,handbrake=false)=>({throttle,steer,handbrake,boost:false});
const run=(v,seconds,i,fps=120)=>{for(let n=0;n<Math.round(seconds*fps);n++)v.update(1/fps,i);};
const car=()=>{const v=new HarborVehicle();v.reset(-29,52,0);return v;};
test('harbor: steering at rest turns the wheels without rotating or translating the car',()=>{
 const v=car();run(v,1,input(0,1));assert.equal(v.yaw,0);assert.equal(v.x,-29);assert.equal(v.z,52);assert.ok(v.steering>.4);
});
test('harbor: throttle builds speed, release coasts and handbrake stops the car',()=>{
 const v=car();run(v,1,input(1));const speed=v.speed,z=v.z;
 assert.ok(speed>4&&speed<7);run(v,1,input());assert.ok(v.z>z+3);assert.ok(v.speed>speed*.7);
 run(v,1,input(0,0,true));assert.ok(Math.abs(v.speed)<.03);
});
test('harbor: opposite pedal brakes before reverse and reverse steering changes yaw the other way',()=>{
 const v=car();run(v,.7,input(1));run(v,.1,input(-1));assert.ok(v.speed>0);
 run(v,1.4,input(-1));assert.ok(v.speed<-.5);const yaw=v.yaw;run(v,.5,input(-1,1));assert.ok(v.yaw<yaw-.02);
});
test('harbor: grip, suspension and movement agree at 30, 60 and 120 render FPS',()=>{
 const drive=fps=>{const v=car();for(const [s,i]of [[1,input(1)],[1,input(1,.3)],[.5,input()],[.5,input(0,0,true)]])run(v,s,i,fps);return v.snapshot();};
 const ref=drive(120);for(const fps of[30,60]){const v=drive(fps);for(const k of ['x','z','speed','yaw','roll','pitch','wheelTravel'])assert.ok(Math.abs(v[k]-ref[k])<1e-6,`${fps} ${k}: ${v[k]} vs ${ref[k]}`);}
});
test('harbor: a left arc loads the outside right side of the suspended body',()=>{
 const v=car();run(v,1,input(1));run(v,.55,input(1,.5));
 assert.ok(v.yaw>.02);assert.ok(v.roll>.001);
});
test('harbor: full car footprint contacts bridge rails and solid containers without crossing them',()=>{
 const v=new HarborVehicle();v.reset(3,20,Math.PI/2);run(v,3,input(1));assert.ok(v.contacts>0);assert.ok(harborDriveable(v.x,v.z,v.yaw));assert.ok(v.x<7);
 const obstacle={minX:-32,maxX:-28,minZ:60,maxZ:63,minY:-5,maxY:-2};
 const c=new HarborVehicle([obstacle]);c.reset(-30,52,0);run(c,3,input(1));assert.ok(c.contacts>0);assert.ok(c.z<58);assert.ok(harborDriveable(c.x,c.z,c.yaw,[obstacle]));
});
const warehouse={minX:-56,maxX:-38,minZ:45,maxZ:75,minY:-5,maxY:13};
test('harbor: a turning impact at the warehouse corner never embeds the body and reverse escapes',()=>{
 // Previously the independently accepted X/Z moves left this pose inside the corner;
 // two seconds of reverse then moved exactly zero metres.
 for(const [x,z,yaw,steer] of [[-35,40,-.4,-.5],[-35,42,-.8,-1],[-36,77,.8,1]]){
  const v=new HarborVehicle([warehouse]);v.reset(x,z,yaw);
  for(let n=0;n<360;n++){
   v.update(1/120,input(1,steer));
   assert.ok(harborDriveable(v.x,v.z,v.yaw,[warehouse]),`invalid forward pose at ${n}`);
  }
  assert.ok(v.contacts>0);const hit=v.snapshot();
  for(let n=0;n<240;n++){
   v.update(1/120,input(-1));
   assert.ok(harborDriveable(v.x,v.z,v.yaw,[warehouse]),`invalid reverse pose at ${n}`);
  }
  assert.ok(Math.hypot(v.x-hit.x,v.z-hit.z)>2,'reverse must leave the contact without RESET');
  assert.ok(v.speed<-.5);
 }
});
test('harbor: a glancing wall impact keeps tangential motion without jittering back through the wall',()=>{
 const wall={minX:-40,maxX:-38,minZ:-30,maxZ:180,minY:-5,maxY:12};
 const v=new HarborVehicle([wall]);v.reset(-34,10,-.3);
 run(v,2,input(1));const first=v.snapshot();run(v,2,input(1));
 assert.ok(v.contacts>0);assert.ok(v.z>first.z+10,'continue sliding along the wall');
 assert.ok(v.speed>5);assert.ok(Math.abs(v.vx)<1e-6,'only the incoming normal velocity is removed');
 assert.ok(v.x-Math.abs(Math.sin(v.yaw))*1.65-1.06>=wall.maxX,'whole capsule stays outside the wall');
});
test('harbor: bridge rails and quay edges allow reversing after a head-on impact',()=>{
 for(const [x,z,yaw] of [[3,20,Math.PI/2],[-70,20,-Math.PI/2],[-28,254,0],[70,20,Math.PI/2]]){
  const v=new HarborVehicle();v.reset(x,z,yaw);run(v,3,input(1,.2));
  assert.ok(v.contacts>0);const hit=v.snapshot();run(v,2,input(-1));
  assert.ok(Math.hypot(v.x-hit.x,v.z-hit.z)>2);
  assert.ok(harborDriveable(v.x,v.z,v.yaw));assert.ok(v.speed<-.5);
 }
});
test('harbor: simultaneous corner contacts cannot commit two separately valid axis moves',()=>{
 const walls=[{minX:-40,maxX:-38,minZ:40,maxZ:90,minY:-5,maxY:12},
  {minX:-38,maxX:-20,minZ:80,maxZ:82,minY:-5,maxY:12}];
 const v=new HarborVehicle(walls);v.reset(-33,74,-.6);
 for(let n=0;n<480;n++){v.update(1/120,input(1,-.3));assert.ok(harborDriveable(v.x,v.z,v.yaw,walls));}
 const hit=v.snapshot();assert.ok(v.contacts>0);run(v,2,input(-1));
 assert.ok(Math.hypot(v.x-hit.x,v.z-hit.z)>2);assert.ok(harborDriveable(v.x,v.z,v.yaw,walls));
});
test('harbor: boosted impacts remain outside thin obstacles and escape consistently at 30/60/120 FPS',()=>{
 const thin={minX:-60,maxX:-22,minZ:80,maxZ:80.05,minY:-5,maxY:-2};
 const drive=fps=>{
  const v=new HarborVehicle([thin]);v.reset(-30,20,0);
  for(let n=0;n<5*fps;n++){
   v.update(1/fps,{...input(1),boost:true});
   assert.ok(v.z+1.65+1.06<=80,'cannot tunnel across the thin wall');
  }
  assert.ok(v.contacts>0);const hit=v.z;run(v,2,input(-1),fps);
  assert.ok(v.z<hit-2);return v.snapshot();
 };
 const reference=drive(120);for(const fps of [30,60]){
  const actual=drive(fps);for(const key of ['x','z','yaw','speed'])assert.ok(Math.abs(actual[key]-reference[key])<1e-7);
 }
});
test('harbor: access ramp joins the bridge and forecourt with continuous support height',()=>{
 const v=new HarborVehicle();v.reset(0,160,0);let last=0,min=0;
 for(let n=0;n<7*120;n++){v.update(1/120,input(1));assert.ok(Math.abs(v.y-last)<.03);last=v.y;min=Math.min(min,v.y);}
 assert.ok(min<-4.9);assert.equal(harborHeight(0,180),0);assert.ok(Math.abs(harborHeight(0,234)+4.994)<1e-6);assert.equal(harborHeight(12,100),null);
});
test('harbor: camera ray stops before a facade and remains unobstructed on open pavement',()=>{
 const b={minX:0,maxX:10,minZ:10,maxZ:20,minY:-5,maxY:15};
 assert.ok(cameraObstruction([5,0,5],[5,2,25],[b])<.3);assert.equal(cameraObstruction([-5,0,5],[-5,2,25],[b]),1);
});
