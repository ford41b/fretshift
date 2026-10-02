import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const postcss = require('postcss');
const changed = ['src/vision/preprocess.ts','src/vision/client.ts','src/ui/components/VisionImport.tsx','src/ui/screens/Import.tsx','src/ui/screens/Immersive.tsx','src/ui/components/StrummingPattern.tsx'];
for (const name of changed) {
  const s = fs.readFileSync(name,'utf8');
  const r = ts.transpileModule(s, {fileName:name,compilerOptions:{jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  if (r.diagnostics?.length) throw Error(name+': '+r.diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));
}
for (const name of ['src/ui/mobile-glass.css','src/ui/immersive.css','src/ui/tokens.css','src/vision/vision.css']) postcss.parse(fs.readFileSync(name,'utf8'),{from:name});
const toggles=changed.filter(name=>name.endsWith('.tsx')).reduce((sum,name)=>sum+(fs.readFileSync(name,'utf8').match(/<GlassSwitch\b/g)?.length||0),0);
if(toggles!==11)throw Error(`Expected 11 glass switches (including crop tiling and timing confirmation); saw ${toggles}`);
console.log(`PASS: ${changed.length} modified TS/TSX files transpile, four CSS files parse, ${toggles} existing GlassSwitch controls active`);
