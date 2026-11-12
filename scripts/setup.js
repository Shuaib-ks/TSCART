import { existsSync,copyFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(Number(process.versions.node.split('.')[0])!==24){console.error('Please install Node.js 24.x LTS, then run setup again.');process.exit(1);}
if(!existsSync(resolve(root,'.env'))){copyFileSync(resolve(root,'.env.example'),resolve(root,'.env'));console.log('Created your local .env configuration. Demo mode is selected.');}
else console.log('Your existing .env configuration was kept.');
console.log('\nReady. Run: npm start\nThen open: http://localhost:3000\nAdmin: http://localhost:3000/admin\n\nRead START-HERE.md before launch. No dependency installation is required.');
