import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'evidence/harbor-film');
fs.mkdirSync(out,{recursive:true});
const url=process.env.FILM_URL||'http://localhost:8910/harbor-film.html';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'zhuda-harbor-player-'));
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
 '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
 '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'
],{stdio:'ignore'});
let socket;const errors=[];
try{
 const portFile=path.join(profile,'DevToolsActivePort');
 for(let i=0;!fs.existsSync(portFile)&&i<100;i++)await delay(100);
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});let id=0;const pending=new Map();
 socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
 const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await cdp('Runtime.enable');await cdp('Page.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url});
 let ready=false;
 for(let i=0;i<200;i++){if(await ev('document.querySelector("video")?.readyState>=3')){ready=true;break;}await delay(100);}
 assert.ok(ready,'movie loads');
 const metadata=await ev(`(()=>{const v=document.querySelector('video');return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,source:v.currentSrc,error:v.error?.message||null};})()`);
 assert.equal(metadata.width,3840);assert.equal(metadata.height,2160);assert.equal(metadata.error,null);
 const playback=await ev(`(async()=>{
  const v=document.querySelector('video');v.muted=true;await v.play();
  await new Promise(r=>setTimeout(r,1000));
  const before=v.getVideoPlaybackQuality(),start=performance.now(),mediaStart=v.currentTime;
  await new Promise(r=>setTimeout(r,8000));
  const after=v.getVideoPlaybackQuality();v.pause();
  return {seconds:(performance.now()-start)/1000,mediaSeconds:v.currentTime-mediaStart,
   presentedFrames:after.totalVideoFrames-before.totalVideoFrames,droppedFrames:after.droppedVideoFrames-before.droppedVideoFrames,
   reference:'Apple M4 / Chrome headless / 1440×1050 viewport / 4K source'};
 })()`);
 assert.ok(playback.mediaSeconds>7.8 && playback.mediaSeconds<8.3,JSON.stringify(playback));
 assert.ok(playback.presentedFrames>=450,JSON.stringify(playback));assert.equal(playback.droppedFrames,0,JSON.stringify(playback));
 const saved=await ev('document.querySelector("video").currentTime');
 await ev("document.querySelectorAll('[data-quality]')[1].click()");
 for(let i=0;i<200;i++){if(await ev(`document.querySelector("video").videoWidth===1920&&document.querySelector("video").readyState>=3&&Math.abs(document.querySelector("video").currentTime-${saved})<.1`))break;await delay(100);}
 const fallback=await ev(`(()=>{const v=document.querySelector('video');return {width:v.videoWidth,height:v.videoHeight,time:v.currentTime,paused:v.paused,selected:document.querySelector('[data-quality="1080p"]').getAttribute('aria-pressed')};})()`);
 assert.equal(fallback.width,1920);assert.equal(fallback.height,1080);assert.equal(fallback.selected,'true');assert.equal(fallback.paused,true);assert.ok(Math.abs(fallback.time-saved)<.1,JSON.stringify({fallback,saved}));
 await ev("document.querySelectorAll('[data-quality]')[0].click()");
 for(let i=0;i<200;i++){if(await ev('document.querySelector("video").videoWidth===3840&&document.querySelector("video").readyState>=3'))break;await delay(100);}
 await ev('document.querySelector("video").currentTime=1.5');await delay(250);
 const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'film-player.png'),Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);
 const result={checkedAt:new Date().toISOString(),url,metadata,playback,fallback,errors};
 fs.writeFileSync(path.join(out,'playback-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{socket?.close();chrome.kill('SIGTERM');await delay(1000);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
