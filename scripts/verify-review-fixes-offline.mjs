import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const files=['src/vision/preprocess.ts','src/io/pdfText/index.ts','src/schema/song.v1.ts','src/schema/practice.ts','src/audio/immersive/score.ts','src/ui/screens/Immersive.tsx','src/ui/screens/Import.tsx','src/ui/components/VisionImport.tsx','src/ui/screens/Progress.tsx'];
for(const file of files){
 const syntax=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 assert.equal(syntax.diagnostics.length,0,`${file}: ${syntax.diagnostics.map(d=>d.messageText).join('; ')}`);
}
const parseChordName=(input)=>{if(!/^[A-G](?:#|b)?(?:m|maj|sus|dim|aug|add|[0-9]|\/[A-G#b]|$)/.test(input))throw Error('invalid'); return input;};
const mock=(name)=>{
 if(name.includes('pdf.worker'))return {default:''};
 if(name.includes('migrations'))return {loadSong:x=>x};
 if(name.includes('song.v1'))return {newSong:()=>({title:'Untitled',artist:'',currentKey:{root:'C',mode:'major'},originalKey:{root:'C',mode:'major'},capo:0,tempo:120,timeSignature:[4,4],measures:[]}),NoteNameSchema:{parse:x=>x}};
 if(name.includes('chordName'))return {parseChordName,pcOf:()=>0,shiftChord:n=>n,spell:()=> 'C',NoteNameSchema:{parse:x=>x}};
 if(name.includes('transforms'))return {scoreDifficulty:()=>1};
 if(name.includes('types'))return {};
 throw Error('unexpected import '+name);
};
function load(file){const c=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});const ctx={exports:{},require:mock,crypto:globalThis.crypto,console,TextDecoder,Uint8Array};vm.runInNewContext(c.outputText,ctx,{filename:file});return ctx.exports;}
const {pdfPagesToSongs,findChordReviewItems}=load('src/io/pdfText/index.ts');
const pages=pdfPagesToSongs([{number:1,text:'A Test\nVerse\nC G | Am F |\nLyric line'}],new Set());
assert.equal(pages.length,1);
assert.equal(pages[0].measures.length,2,'barlines split into two measures');
assert.equal(pages[0].measures[0].timingConfirmed,false,'no invented attack timing');
assert.equal(pages[0].provenance.timingNeedsConfirmation,true);
assert.equal(pages[0].measures[1].chords.length,2);
assert.match(pages[0].measures[0].sourceLine,/C G/);
const review=findChordReviewItems('C | B♭ | G\n[A?]unclear',2);
assert.equal(review.length,2,'preserves plausible unknown chord tokens');
assert.equal(review[0].token,'B♭');
assert.equal(review[0].suggestion,'Bb');
assert.equal(review[1].suggestion,undefined);
assert.equal(findChordReviewItems('B♭',1).length,1,'standalone unreadable flat must not disappear');
const {cropRectangle,tileCrops}=load('src/vision/preprocess.ts');
assert.equal(JSON.stringify(cropRectangle(1000,800,{top:.1,right:.2,bottom:.05,left:.03})),JSON.stringify([30,80,770,680]));
const tiles=tileCrops({top:0,right:0,bottom:0,left:0});
assert(tiles[0].bottom<.5&&tiles[1].top<.5,'tiles overlap rather than drop chord details');
assert(!fs.readFileSync('src/ui/screens/Import.tsx','utf8').includes('title: "Text-layer PDF"'));
assert(fs.readFileSync('src/ui/screens/Immersive.tsx','utf8').includes('mode === "visual" ? <div className="imm-stats"'));
assert(fs.readFileSync('src/ui/components/VisionImport.tsx','utf8').includes('Prepare exact OCR previews'));
console.log('PASS: 9 modified TS/TSX modules parse');
console.log('PASS: barlines create 2 measures; attack timing explicitly unconfirmed; original source lines kept');
console.log('PASS: suspicious B♭ and A? retained with suggestion only where evidence supports it');
console.log('PASS: independent crop geometry and overlapping tiles');
console.log('PASS: unified chooser, visual-only results branch, preview-before-OCR UI guards');
