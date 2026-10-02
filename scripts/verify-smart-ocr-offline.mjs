/** Run dependency-free checks against the real per-page client module, with only dependencies mocked. */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript"); }
const source = fs.readFileSync(new URL("../src/vision/client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName:"client.ts", compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}, reportDiagnostics:true });
assert.equal(compiled.diagnostics.length,0);
const schema = {parse:x=>x};
const requireMock = name => {
  if (name.includes("cloud/client")) return {cloudConfig:()=>({url:"https://fake.supabase.co",key:"key"}),getAccessToken:async()=>"token",getSession:()=>({user:{id:"person1"}})};
  if (name.includes("pdfText")) return {pdfPagesToSongs:()=>[{title:"OK"}]};
  if (name.includes("types")) return {PreparedVisionPageSchema:schema,VisionHintsSchema:schema,VisionWireResultSchema:schema,MAX_VISION_PAGES:10};
  throw Error(name);
};
const context={exports:{},require:requireMock,Request,AbortController,DOMException,fetch,setTimeout,clearTimeout,console};
vm.runInNewContext(compiled.outputText,context);
const {recognizeVisionTextPage}=context.exports;
const page={id:"p3",fileName:"page-3.jpg",dataUrl:"data:image/jpeg;base64,YQ==",width:50,height:70};
const wire={pages:[{id:"p3",text:"No chords recognized; retain this for manual editing"}],pageIds:["p3"],modelId:"ocr",promptVersion:"1",processedAt:new Date().toISOString()};
let calls=0;
const result=await recognizeVisionTextPage(page,undefined,async request=>{
 calls++;
 assert.equal(JSON.parse(await request.text()).pages.length,1);
 if(calls===1) throw Error("request timed out");
 return wire;
},100);
assert.equal(calls,2);
assert.equal(result.text,wire.pages[0].text);
let cancelled=0;
const controller=new AbortController();
await assert.rejects(recognizeVisionTextPage(page,controller.signal,async ()=>{
 cancelled++; controller.abort();throw Error("closed");
},100),{name:"AbortError"});
assert.equal(cancelled,1);
console.log("PASS: one-page request, retry only that page, retain non-chart text, abort without retry");
