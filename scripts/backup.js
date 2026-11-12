import { DatabaseSync,backup } from 'node:sqlite';
import { mkdir,cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,process.env.DATA_DIR||'data');
if(!existsSync(join(source,'tscart.sqlite'))){console.error('Start the store once before making a backup.');process.exit(1);}
const destination=join(root,'backups',new Date().toISOString().replaceAll(':','-'));
await mkdir(destination,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(source,'tscart.sqlite'));
try{await backup(db,join(destination,'tscart.sqlite'));await cp(join(source,'order-secret'),join(destination,'order-secret'));if(existsSync(join(source,'uploads')))await cp(join(source,'uploads'),join(destination,'uploads'),{recursive:true});}finally{db.close();}
console.log('Backup created at '+destination+'\nKeep this directory private; it contains customer details and authentication data.');
