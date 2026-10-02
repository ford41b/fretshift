import { chromium, webkit, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const port = 5396, url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'], {stdio:'pipe'});
const results = [];
let browser;
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Preview startup timed out')),15000);
    server.stdout.on('data',chunk=>{if(chunk.toString().includes(String(port))){clearTimeout(timeout);resolve();}});
    server.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Preview exited ${code}`));});
  });
  for (const [name, engine] of [['chrome',chromium],['webkit',webkit]]) {
    browser = await engine.launch(name==='chrome' ? {channel:process.env.CI?undefined:'chrome'} : {});
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const page = await context.newPage();
    const errors=[];
    await page.exposeFunction('reportValidationError',error=>errors.push(error));
    await page.addInitScript(()=>window.addEventListener('error',event=>window.reportValidationError({message:event.message,filename:event.filename})));
    await page.goto(`${url}/import`);
    await expect(page.getByRole('button',{name:/Audio recording/})).toBeVisible();
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await page.reload();
    expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    if(name==='webkit') {
      // WebKit offline emulation rejects SW navigation (Playwright issue #42775).
      // Stop the origin instead, proving cached operation with the server unreachable.
      await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});
      await expect(fetch(url)).rejects.toThrow();
    } else await context.setOffline(true);
    await page.reload();
    await page.getByRole('button',{name:/Audio recording/}).click();
    await page.getByLabel(/Also transcribe a single-note/).check();
    const started=Date.now();
    await page.getByLabel('Choose audio for Audio Intelligence').setInputFiles('test-fixtures/audio-notes/single-note-melody.wav');
    await expect(page.locator('.ai-tab-note')).toHaveCount(5,{timeout:30000});
    const importMs=Date.now()-started;
    await page.getByRole('button',{name:'Mark all uncertain regions Unknown'}).click();
    await page.getByLabel('BPM',{exact:true}).fill('120');
    await page.getByLabel('First beat (s)').fill('0');
    await page.getByRole('button',{name:'Apply BPM and rebuild beats'}).click();
    await page.getByLabel('Song title').fill('Offline note review');
    await page.getByRole('button',{name:'Save as FretShift song'}).click();
    const link=page.getByRole('link',{name:'Reopen transcription'});
    await expect(link).toBeVisible();
    await link.click(); await page.reload();
    await expect(page.getByLabel('Song title')).toHaveValue('Offline note review');
    await expect(page.locator('.ai-tab-note')).toHaveCount(5);
    await expect(page.locator('.ai-tab-note.confirmed')).toHaveCount(0);
    await page.getByLabel('Reattach original audio').setInputFiles('test-fixtures/audio-notes/single-note-melody.wav');
    await expect(page.getByText('Original audio verified and attached for this session.')).toBeVisible();
    await page.getByRole('button',{name:'Loop selected note'}).click();
    await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(false);
    await page.locator('audio').evaluate(a=>a.pause());
    // Vite preview has no Vercel telemetry endpoint; its SPA fallback can return HTML.
    // Keep this exact environment error in the report; reject all application errors.
    const previewAnalyticsErrors=errors.filter(error=>error.filename===`${url}/_vercel/insights/script.js`);
    expect(errors.filter(error=>!previewAnalyticsErrors.includes(error))).toEqual([]);
    results.push({browser:name,version:browser.version(),viewport:'390x844 desktop simulation',status:'passed',importMs,networkFailure:name==='webkit'?'origin server stopped':'Playwright offline emulation',
      checks:['production service worker controls page','offline reload','offline decode/Worker/note review','save and offline reload','fingerprint reattachment','playback','unconfirmed notes remain unconfirmed'],pageErrors:errors,previewAnalyticsErrors:previewAnalyticsErrors.length,telemetryVerified:false});
    await browser.close(); browser=undefined;
  }
} finally {
  await browser?.close(); server.kill('SIGTERM');
  writeFileSync('docs/post-phase-3-validation/production-offline.json',JSON.stringify({generatedAt:new Date().toISOString(),physicalDevice:false,installedPwa:false,results},null,2)+'\n');
}
console.log(JSON.stringify(results,null,2));
