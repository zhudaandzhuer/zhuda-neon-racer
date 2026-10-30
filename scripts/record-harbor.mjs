import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Offline frame capture of the actual pinned WebGL renderer, not a live-FPS benchmark.
// Every output frame advances 1/60 s; HarborVehicle keeps its normal 120 Hz steps.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=path.join(root,'evidence/harbor-film'),media=path.join(root,'public/media');
const pilot=process.argv.includes('--preview'),reuse=process.argv.includes('--reuse');
const fps=60,width=1920,height=1080,dpr=2,warmup=48;
const clips=[
  {id:'waterfront',label:'LIGHT / SURFACE / SCALE',seconds:4,x:-29,z:52,yaw:Math.PI,speed:0,throttle:false,camera:'hero'},
  {id:'bridge',label:'THE BRIDGE / IN MOTION',seconds:6,x:0,z:35,yaw:0,speed:0,throttle:true,camera:'front'},
  {id:'dock',label:'THE DOCK / FREE DRIVE',seconds:6,x:-29,z:80,yaw:Math.PI,speed:8,throttle:false,camera:'chase'},
  {id:'warehouse',label:'HARBOR / 01',seconds:4,x:-29,z:52,yaw:Math.PI,speed:0,throttle:false,camera:'wide'},
];
fs.mkdirSync(work,{recursive:true});fs.mkdirSync(media,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'zhuda-harbor-film-'));
const url=new URL(process.env.GAME_URL||'http://localhost:8907/visual.html');
url.searchParams.set('view','dock');url.searchParams.set('quality','high');url.searchParams.set('targetFPS','60');
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--disable-background-timer-throttling',
  '--disable-renderer-backgrounding','--hide-scrollbars','about:blank',
],{stdio:'ignore'});
let socket;
let stopping=false;
process.once('SIGINT',()=>{stopping=true;});
process.once('SIGTERM',()=>{stopping=true;});
const errors=[],failures=[],started=Date.now();
try{
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile)&&i<150;i++)await delay(100);
  assert.ok(fs.existsSync(portFile),'Chrome did not start');
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  const rejectAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  socket.onclose=()=>rejectAll(new Error('Capture Chrome closed'));
  socket.onerror=()=>rejectAll(new Error('Capture transport failed'));
  socket.onmessage=({data})=>{
    const m=JSON.parse(data);
    if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
    else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description));
    else if(m.method==='Network.loadingFailed'&&!m.params.canceled)failures.push(m.params.errorText);
  };
  const cdp=(method,params={},timeout=120000)=>new Promise((resolve,reject)=>{
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error(`Capture timeout: ${method}`));},timeout);
    pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}));
  });
  const ev=async expression=>{
    const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
  await cdp('Page.navigate',{url:url.href});
  let ready=false;
  for(let i=0;i<1200;i++){if(await ev('!!window.harborStudy?.ready')){ready=true;break;}await delay(100);}
  assert.ok(ready,'Harbor did not finish loading');
  const initial=await ev(`(()=>{
    const h=harborStudy;
    Laya.Render.paused=true;Laya.timer.clearAll(h);
    h.enterFreeExplore();h.freeKeys.clear();
    const style=document.createElement('style');style.textContent='footer,#drive-hud,#explore-help,header p{display:none!important}header{display:block!important}#film-label{position:fixed;left:38px;bottom:28px;z-index:5;font:10px system-ui;letter-spacing:.25em;color:#e8ddc5}#film-note{position:fixed;right:38px;bottom:28px;z-index:5;font:10px system-ui;letter-spacing:.12em;color:#d6dce0}';document.head.append(style);
    for(const [id,text] of [['film-label','HARBOR / 01'],['film-note','WEBGL FRAME CAPTURE · 4K / 60 FPS']]){const node=document.createElement('div');node.id=id;node.textContent=text;document.body.append(node);}
    const originalStep=h.freeStep;
    window.film={shot:null,t:0,warming:true,clock:performance.now(),renders:0};
    h.freeStep=function(dt){if(!film.warming)originalStep.call(this,dt);};
    h.freePose=function(){
      const v=h.vehicle,s=film.shot,u=film.t/s.seconds;
      if(s.camera==='hero'){
        const angle=.55+u*.27,distance=8.4-u*.4;
        return {eye:[v.x+Math.sin(angle)*distance,v.y+1.65,v.z-Math.cos(angle)*distance],target:[v.x,v.y+.85,v.z],fov:42};
      }
      if(s.camera==='front')return {eye:[v.x+3.7-u*.8,v.y+1.55,v.z+8.7],target:[v.x,v.y+.85,v.z+.15],fov:43};
      if(s.camera==='chase')return {eye:[v.x+4.2-u*1.2,v.y+2.4,v.z+9.3],target:[v.x-.7,v.y+.9,v.z-1.4],fov:48};
      return {eye:[-15-u*3,1.6+u*1.4,35-u*2],target:[-38,-2.8,60],fov:46};
    };
    film.begin=s=>{
      film.shot=s;film.t=0;film.warming=true;h.freeKeys.clear();h.vehicle.reset(s.x,s.z,s.yaw);
      h.updateDrivingModel();h.pipeline.resetHistory();document.getElementById('film-label').textContent=s.label;
    };
    film.render=(t,dt)=>{
      film.t=t;h.lastReflection=-Infinity;h.draw(dt);
      film.clock+=1000/60;Laya.Render.forceOnce=true;Laya.Render.loop(film.clock);film.renders++;
      return {frame:film.renders,position:[h.vehicle.x,h.vehicle.y,h.vehicle.z],speed:h.vehicle.speed,contacts:h.vehicle.contacts};
    };
    film.start=()=>{
      const s=film.shot,v=h.vehicle;v.vx=Math.sin(s.yaw)*s.speed;v.vz=Math.cos(s.yaw)*s.speed;v.speed=s.speed;
      if(s.throttle)h.freeKeys.add('KeyW');film.warming=false;
    };
    const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl'),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {quality:h.report().quality,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  })()`);
  assert.equal(initial.quality.mode,'high');assert.equal(initial.quality.tier,'high');
  assert.deepEqual(initial.quality.canvas,[3840,2160]);
  for(const key of ['ao','bloom','taa'])assert.equal(initial.quality[key],true,key);
  assert.equal(initial.quality.shadowResolution,4096);assert.deepEqual(initial.quality.reflectionSize,[1280,800]);
  const metadata=[];
  for(const clip of clips){
    const folder=path.join(work,clip.id);fs.mkdirSync(folder,{recursive:true});
    const frames=Math.round(clip.seconds*fps),hashes=[],samples=[];
    if(reuse&&!pilot&&fs.existsSync(path.join(folder,'capture.json'))){
      const old=JSON.parse(fs.readFileSync(path.join(folder,'capture.json'),'utf8'));
      assert.deepEqual(old.clip,clip);assert.equal(old.frames,frames);
      for(let i=0;i<frames;i++){
        const bytes=fs.readFileSync(path.join(folder,`${String(i).padStart(4,'0')}.png`));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),old.hashes[i]);
      }
      metadata.push(old);console.log(`Reused verified ${clip.id}: ${frames} frames`);continue;
    }
    await ev(`film.begin(${JSON.stringify(clip)})`);
    for(let i=0;i<warmup;i++)await ev('film.render(0,0)');
    await ev('film.start()');
    const selected=pilot?new Set([0,Math.floor(frames/2),frames-1]):null;
    for(let i=0;i<frames;i++){
      if(stopping)throw new Error('Capture stopped; completed clips can be reused.');
      const state=await ev(`film.render(${i/fps},${i===0?0:1/fps})`);
      assert.equal(state.contacts,0,`${clip.id}: capture route must not collide`);
      if(i===0||i===Math.floor(frames/2)||i===frames-1)samples.push({index:i,...state});
      if(selected&&!selected.has(i))continue;
      const {data}=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,optimizeForSpeed:true});
      const bytes=Buffer.from(data,'base64');
      assert.equal(bytes.readUInt32BE(16),3840);assert.equal(bytes.readUInt32BE(20),2160);
      const name=pilot?`preview-${String(i).padStart(4,'0')}.png`:`${String(i).padStart(4,'0')}.png`;
      fs.writeFileSync(path.join(folder,name),bytes);hashes.push(createHash('sha256').update(bytes).digest('hex'));
      if(!pilot&&(i+1)%60===0)console.log(`Captured ${clip.id}: ${i+1}/${frames} at High / 3840×2160`);
    }
    assert.equal(new Set(hashes).size,hashes.length,'Every captured PNG must be distinct');
    const item={clip,frames:pilot?3:frames,hashes,samples};metadata.push(item);
    if(!pilot)fs.writeFileSync(path.join(folder,'capture.json'),JSON.stringify(item,null,2)+'\n');
    console.log(`${pilot?'Previewed':'Completed'} ${clip.id}`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const report={sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    engineRevision:'74b04064208f8afe624896482d7bc438dd15dc29',checkedAt:new Date().toISOString(),
    method:'Actual High-preset WebGL frames, each advanced by 1/60 s, using the normal 120 Hz vehicle simulation. Offline capture; playback FPS is not a live-performance claim. No frame interpolation or duplicate-frame padding.',
    fps,width:3840,height:2160,durationSeconds:20,frames:1200,warmupPerClip:warmup,
    initial,clips:metadata,errors,failures,wallSeconds:(Date.now()-started)/1000};
  fs.writeFileSync(path.join(work,pilot?'preview.json':'capture.json'),JSON.stringify(report,null,2)+'\n');
  if(pilot){console.log('Preview capture complete.');}
  else{
    const ffmpeg=process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg';
    const run=args=>execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit',maxBuffer:2**22});
    const encoded=[];
    for(const clip of clips){
      const out=path.join(work,clip.id+'.mp4');
      run(['-framerate','60','-i',path.join(work,clip.id,'%04d.png'),'-frames:v',String(clip.seconds*fps),
        '-an','-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-r','60',
        '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',out]);
      encoded.push(out);console.log(`Encoded ${clip.id}`);
    }
    const list=path.join(work,'concat.txt');fs.writeFileSync(list,encoded.map(file=>`file '${file}'`).join('\n')+'\n');
    const master=path.join(media,'harbor-4k60.mp4');
    run(['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',master]);
    run(['-i',master,'-vf','scale=1920:1080:flags=lanczos','-an','-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-r','60','-movflags','+faststart',path.join(media,'harbor-1080p60.mp4')]);
    run(['-ss','1.5','-i',master,'-frames:v','1','-q:v','2','-update','1',path.join(media,'harbor-poster.jpg')]);
    const docsMedia=path.join(root,'docs/media');fs.mkdirSync(docsMedia,{recursive:true});
    run(['-i',master,'-filter_complex',
      '[0:v]split=3[a][b][c];[a]trim=start=0.5:end=1.5,setpts=PTS-STARTPTS[a1];[b]trim=start=5:end=6,setpts=PTS-STARTPTS[b1];[c]trim=start=11:end=12,setpts=PTS-STARTPTS[c1];[a1][b1][c1]concat=n=3:v=1:a=0,fps=12,scale=640:360:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-loop','0',path.join(docsMedia,'harbor-preview.gif')]);
    execFileSync(process.env.PYTHON_PATH||'python3',[path.join(root,'scripts/harbor-preview.py')],{stdio:'inherit'});
    const probe=process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe';
    report.outputs=[];
    for(const name of ['harbor-4k60.mp4','harbor-1080p60.mp4']){
      const file=path.join(media,name),info=JSON.parse(execFileSync(probe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
      const stream=info.streams.find(s=>s.codec_type==='video');
      assert.equal(stream.nb_read_frames,'1200');assert.equal(stream.avg_frame_rate,'60/1');
      assert.ok(Math.abs(Number(stream.duration)-20)<1/fps);assert.ok(fs.statSync(file).size<99*1024*1024,'GitHub file limit');
      const item={name,bytes:fs.statSync(file).size,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),width:stream.width,height:stream.height,frames:Number(stream.nb_read_frames),fps:stream.avg_frame_rate,duration:Number(stream.duration)};
      report.outputs.push(item);
    }
    // Keep the public provenance compact; per-frame hashes stay with source capture evidence.
    const summary={...report,clips:report.clips.map(({hashes,...clip})=>({...clip,uniqueFrames:hashes.length,frameHashDigest:createHash('sha256').update(hashes.join('\n')).digest('hex')}))};
    fs.writeFileSync(path.join(docsMedia,'harbor-recording.json'),JSON.stringify(summary,null,2)+'\n');
    console.log(JSON.stringify(report.outputs,null,2));
  }
}finally{
  socket?.close();chrome.kill('SIGTERM');
  await new Promise(resolve=>{if(chrome.exitCode!==null)resolve();else{chrome.once('exit',resolve);setTimeout(resolve,2500);}});
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
