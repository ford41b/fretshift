// Production build offline check: install the PWA, stop the server, then run a scored
// Immersive Learn pass on an ordinary song through the controlled microphone.
// BROWSER=webkit (default) or BROWSER=chromium. Emulated browser evidence, not a phone.
import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const engine = process.env.BROWSER === 'chromium' ? chromium : webkit;
const port=5396,url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
let browser;
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview startup timed out')),15000);server.stdout.on('data',s=>{if(s.toString().includes(String(port))){clearTimeout(timer);resolve();}});server.on('exit',code=>reject(new Error(`Preview exited ${code}`)));});
  browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  if (engine === chromium) {
    // Same harness fix as e2e/support/worklets.ts: Playwright leaves Chromium worklets paused for a debugger.
    const cdp=await context.newCDPSession(page);
    cdp.on('Target.attachedToTarget',({sessionId,targetInfo})=>{if(targetInfo.type==='worklet')void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.runIfWaitingForDebugger'})}).catch(()=>{});});
    await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:false});
  }
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
      const ctx=new AudioContext();await ctx.resume();const dest=ctx.createMediaStreamDestination();
      window.playTestNote=()=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=110;gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(.15,ctx.currentTime+.003);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+1);osc.connect(gain).connect(dest);osc.start();osc.stop(ctx.currentTime+1);};
      window.testTracks=()=>dest.stream.getTracks().map(t=>t.readyState);return dest.stream;
    }}});
  });
  await page.goto(`${url}/immersive/sample-2`);await page.getByRole('heading',{name:'House of the Rising Sun',exact:true}).waitFor();
  // Make the arpeggio an ordinary single-note melody: drop its muted (x) cells, which are never scored.
  await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('fretshift-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const tx=open.result.transaction('songs','readwrite'),store=tx.objectStore('songs'),get=store.get('sample-2');get.onsuccess=()=>{const s=get.result;s.measures.forEach(m=>m.tab?.slots.forEach(slot=>slot.forEach((c,i)=>{if(c==='x')slot[i]=null;})));store.put(s);};tx.oncomplete=()=>{open.result.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
  assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),true);
  server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));await page.reload();await page.locator('.launch-splash').waitFor({state:'detached'});
  await page.getByRole('heading',{name:'House of the Rising Sun',exact:true}).waitFor();
  await page.getByRole('button',{name:'Connect microphone',exact:true}).click();await page.getByText('Microphone ready',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start learning',exact:true}).click();
  await page.waitForTimeout(250);await page.evaluate(()=>window.playTestNote());
  await page.waitForFunction(()=>/(^|\D)2 \/ \d+ targets/.test(document.querySelector('.imm-lane-bottom')?.textContent ?? ''));
  await page.getByRole('button',{name:'Finish & see results'}).click();await page.getByText('Saved on this device',{exact:false}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.testTracks()),['ended']);
  await page.goto(`${url}/progress`);await page.locator('.launch-splash').waitFor({state:'detached'});assert.match(await page.locator('.practice-log').innerText(),/Immersive learn · 1\/1 pitch matches/);
  // The existing Vercel analytics script is unavailable on a local preview server.
  const relevant = errors.filter((message,i) => !message.includes('/_vercel/insights/') && !(message === 'TypeError: Load failed' && errors[i+1]?.includes('/_vercel/insights/')));
  assert.deepEqual(relevant,[]);
  console.log(`PASS (${engine.name()}, emulated): installed production shell, capture worklet, analysis worker, ordinary-song note recognition, track cleanup, navigation and saved summary work offline.`);
} finally {await browser?.close();server.kill('SIGTERM');}
