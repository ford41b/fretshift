import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default ts.config({ignores:['FretShift/**','dist/**','node_modules/**','.node_modules-offloaded/**','supabase/**','public/**','scripts/**','playwright-report/**','test-results/**']}, js.configs.recommended, ...ts.configs.recommended, {files:['**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{...hooks.configs.recommended.rules,'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'@typescript-eslint/no-explicit-any':'error'},languageOptions:{globals:{document:'readonly',window:'readonly',navigator:'readonly',URL:'readonly',console:'readonly',setTimeout:'readonly',clearTimeout:'readonly'}}});
