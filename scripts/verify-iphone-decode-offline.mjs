import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
import { randomUUID } from 'node:crypto';
const source = fs.readFileSync(new URL('../src/vision/preprocess.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {fileName:'preprocess.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(output.diagnostics.length,0);
let revokeCount=0, bitmapAttempts=0, images=0, fallbackFails=false;
const url={createObjectURL:()=>`blob:page${++images}`,revokeObjectURL:()=>revokeCount++};
class ImageElement {
  naturalWidth=360;
  width=360;
  height=440;
  naturalHeight=440;
  set src(value) {
    if (value) queueMicrotask(()=>fallbackFails?this.onerror?.():this.onload?.());
  }
}
class FileReaderMock {readAsDataURL() {this.result='data:image/jpeg;base64,YWJj';this.onload?.()}}
const canvas=()=>({width:0,height:0,getContext:()=>({translate(){},rotate(){},drawImage(){}}),toBlob:(cb)=>cb(new Blob(['abc'],{type:'image/jpeg'}))});
const context={exports:{},Error,require:(name)=>name.includes('pdf.worker')?{default:'pdf-worker-url'}:name.includes('types')?{MAX_OCR_SPACE_PAGE_BYTES:1000000,MAX_VISION_FILE_BYTES:12000000,MAX_VISION_PAGES:10,MAX_VISION_TOTAL_BYTES:40000000}:(()=>{throw Error(name)})(),Blob,Image:ImageElement,URL:url,document:{createElement:canvas},FileReader:FileReaderMock,crypto:{randomUUID},console,queueMicrotask,createImageBitmap:async()=>{bitmapAttempts++;throw new Error('Load failed')}};
vm.runInNewContext(output.outputText,context);
const result=await context.exports.preprocessImage({name:'page-1.jpg',type:'image/jpeg'});
assert.equal(bitmapAttempts,1);
assert.match(result.dataUrl,/^data:image\/jpeg/);
assert.equal(revokeCount,1);
assert.equal(result.width,360);
fallbackFails=true;
await assert.rejects(context.exports.preprocessImage({name:'page-2.jpg',type:'image/jpeg'}),/Could not prepare page-2.jpg: Could not decode.*Load failed/);
assert.equal(revokeCount,2);
console.log('PASS: iPhone ImageBitmap Load failed uses image fallback; processed image returned; temporary URLs released; both-decoders-fail gives page-specific actionable message.');
