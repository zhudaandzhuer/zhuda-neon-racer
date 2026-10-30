import test from 'node:test';
import assert from 'node:assert/strict';
import {HarborQualityGovernor,initialQuality,readQualityPreference,qualityDPR} from '../.test-build.mjs';
function feed(g,ms,seconds,start=0,visible=true) {
 let now=start, changes=0;
 for(let n=0;n<seconds*1000/ms;n++){now+=ms;if(g.sample(ms,now,visible))changes++;}
 return {now,changes};
}
test('quality: safe startup and durable preferences reject corrupted or unsupported settings',()=>{
 assert.deepEqual(readQualityPreference('{bad'),{mode:'auto',targetFPS:60});
 assert.deepEqual(readQualityPreference('{"mode":"ultra","targetFPS":120}'),{mode:'auto',targetFPS:60});
 assert.deepEqual(readQualityPreference('{"mode":"balanced","targetFPS":30}'),{mode:'balanced',targetFPS:30});
 assert.equal(initialQuality({coarse:true,cores:8}),'performance');
 assert.equal(initialQuality({memory:4,cores:16}),'performance');
 assert.equal(initialQuality({}),'balanced');
});
test('quality: render resolution obeys density and pixel budgets without increasing native DPR',()=>{
 assert.equal(qualityDPR('high',1600,1000,1),1);
 assert.equal(qualityDPR('high',1600,1000,2),2);
 const dpr=qualityDPR('performance',1920,1080,2);
 assert.ok(dpr>=.5&&dpr<.8);assert.ok(1920*1080*dpr*dpr<=800001);
});
test('quality: sustained slow frames lower effects, then resolution, with a bounded floor',()=>{
 const g=new HarborQualityGovernor({mode:'auto',targetFPS:60},'high');
 feed(g,100,70);
 assert.equal(g.tier,'performance');assert.equal(g.scale,.7);
 const more=feed(g,100,20,70000);assert.equal(more.changes,0);
});
test('quality: stable cadence promotes slowly and a failed trial blocks repeated oscillation',()=>{
 const g=new HarborQualityGovernor({mode:'auto',targetFPS:60},'balanced');
 const first=feed(g,1000/60,28);assert.equal(g.tier,'high');assert.equal(first.changes,1);
 const slow=feed(g,100,14,first.now);assert.equal(g.tier,'balanced');
 feed(g,1000/60,35,slow.now);assert.equal(g.tier,'balanced');
});
test('quality: manual quality stays locked under slow frames and hidden-tab gaps do not degrade auto',()=>{
 const manual=new HarborQualityGovernor({mode:'high',targetFPS:60},'balanced');
 feed(manual,200,35);assert.equal(manual.tier,'high');assert.equal(manual.scale,1);
 const auto=new HarborQualityGovernor({mode:'auto',targetFPS:60},'balanced');
 feed(auto,1000,60,0,false);assert.equal(auto.tier,'balanced');
 feed(auto,1000/60,1,60000);assert.equal(auto.tier,'balanced');
});
test('quality: changing the target reuses the selection and 30 FPS is a valid stable cadence',()=>{
 const g=new HarborQualityGovernor({mode:'auto',targetFPS:60},'balanced');
 g.select({mode:'auto',targetFPS:30},0);
 feed(g,1000/30,12);assert.equal(g.tier,'balanced');assert.ok(g.fps>29&&g.fps<31);
});
