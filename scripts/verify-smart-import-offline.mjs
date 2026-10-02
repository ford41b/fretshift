/** Dependency-free parser checks for this review environment. Run Vitest + Vercel build when deps exist. */
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript"); }
const file = new URL("../src/io/pdfText/index.ts", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const compiled = ts.transpileModule(source, { fileName: "index.ts", compilerOptions: { module: ts.ModuleKind.CommonJS,
 target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(compiled.diagnostics.length, 0);
const parseChordName = (name) => { if (!/^[A-G](?:#|b)?(?:m|maj|sus|dim|aug|add|[0-9]|\/[A-G#b]|$)/.test(name)) throw new Error("invalid chord"); return name; };
const requireMock = (name) => {
  if (name.includes("pdf.worker")) return { default: "" };
  if (name.includes("migrations")) return { loadSong: x => x };
  if (name.includes("song.v1")) return { newSong: () => ({ title: "Untitled", artist:"", currentKey:{root:"C", mode:"major"}, originalKey:{root:"C",mode:"major"}, capo:0,tempo:120,timeSignature:[4,4],measures:[] }), NoteNameSchema:{parse:x=>x} };
  if (name.includes("chordName")) return { parseChordName, pcOf:()=>0, shiftChord:name=>name, spell:()=>"C", NoteNameSchema:{parse:x=>x} };
  if (name.includes("transforms")) return {scoreDifficulty:()=>1};
  throw new Error("unexpected import "+name);
};
const context = { exports:{}, require:requireMock, crypto, console, TextDecoder, Uint8Array };
vm.runInNewContext(compiled.outputText, context, {filename:"src/io/pdfText/index.ts"});
const { pageHasChordContent, pdfPagesToSongs, suggestPdfSplits } = context.exports;
assert.equal(pageHasChordContent("A Song\nPage 2\nJust some text"),false);
assert.equal(pageHasChordContent("[G]Hello [D]world"),true);
assert.equal(pageHasChordContent("C | G | Am | Fmaj7"),true);
const merged = pdfPagesToSongs([
 {number:1,text:"My Tune\nVerse\n[C]Hello [Am]world"},
 {number:2,text:"continuing the song\nwithout another chord"}
],new Set());
assert.equal(merged.length,1);
assert.equal(merged[0].measures[0].chords.length,2);
assert.match(merged[0].measures[0].lyrics,/continuing the song/);
const split = suggestPdfSplits([{number:1,text:"Song 1\nC G\nlyrics"},{number:2,text:"Song 2\nAm F\nwords"}]);
assert.equal(split.has(2),true);
console.log("PASS: parser syntax, non-chord text, inline chords, slash/extended chords, continuation lyrics, page boundary");
