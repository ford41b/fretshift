import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 5395;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'], {stdio:'pipe'});
let browser;
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Preview startup timed out')),15000);
    server.stdout.on('data',chunk=>{if(chunk.toString().includes(String(port))){clearTimeout(timeout);resolve();}});
    server.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Preview exited ${code}`));});
  });
  browser = await chromium.launch({channel:process.env.CI?undefined:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(`${url}/song/sample-1`);
  await page.getByRole('heading',{name:'Strumming pattern',exact:true}).waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();
  assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),true,'Service worker controls the installed shell');
  await context.setOffline(true);
  await page.reload();
  const studio=page.getByRole('region',{name:'Strumming pattern',exact:true});
  await studio.getByRole('button',{name:/^Simple /}).click();
  await studio.getByRole('combobox',{name:'Stroke',exact:true}).selectOption('mute');
  await studio.getByLabel('Variation name').fill('Offline strum');
  await studio.getByRole('button',{name:'Save variation',exact:true}).click();
  await studio.getByRole('heading',{name:'Offline strum'}).waitFor();
  await page.getByText('Saved on this device',{exact:true}).first().waitFor();
  await page.reload();
  await studio.getByRole('heading',{name:'Offline strum'}).waitFor();
  await studio.getByRole('button',{name:'Play strumming',exact:true}).click();
  await studio.locator('.is-playing').waitFor();
  await studio.getByRole('button',{name:'Pause strumming',exact:true}).click();
  await page.goto(`${url}/practice/sample-1`);
  await studio.getByRole('heading',{name:'Offline strum'}).waitFor();
  console.log('PASS: production shell reloads offline; rhythm generation, editing, persistence, navigation and audio work without network.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
