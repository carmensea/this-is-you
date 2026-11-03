// The real two-terminal flow, service plus Vite dev server, on a fictional temp archive. npm run readiness:dev
// npm run readiness uses its own proxy, which once hid a dev-server-only failure of every sign-in and save.
import { chromium } from 'playwright-core'; import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'), PY=REPO+'/backend/.venv/bin/python', PORT=8123;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tiy-dev-')); const data=path.join(dir,'archive'); const env={...process.env,THIS_IS_YOU_DATA_DIR:data,THIS_IS_YOU_PORT:String(PORT)};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const ok=(n,v,d='')=>{console.log((v?'PASS ':'FAIL ')+n+(d?': '+d:'')); if(!v) process.exitCode=1;};
const set=spawnSync(PY,['-m','this_is_you','set-passphrase'],{cwd:REPO,env,input:'fictional dev flow passphrase\n',encoding:'utf8'}); ok('set-passphrase',set.status===0,set.stdout.trim());
const be=spawn(PY,['-m','this_is_you'],{cwd:REPO,env,stdio:'ignore'}); const vite=spawn('npx',['vite'],{cwd:REPO,env,stdio:'ignore',detached:true});
for(let i=0;i<150;i++){if(await fetch('http://127.0.0.1:5180/api/status').then(r=>r.ok,()=>false))break;await sleep(200);}
process.on('exit',()=>{try{be.kill();process.kill(-vite.pid);}catch{}});
const b=await chromium.launch({channel:'chrome',headless:true}); const c=await b.newContext({viewport:{width:1440,height:1000}}); const external=[];
await c.route(/^https?:/,r=>{const h=new URL(r.request().url()).hostname; if(h==='127.0.0.1')return r.continue(); external.push(h); return r.abort();});
const p=await c.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message)); p.setDefaultTimeout(30000);
await p.goto('http://127.0.0.1:5180/#/import'); await p.getByRole('heading',{name:'Sign in to your archive'}).waitFor(); 
ok('the dev server shows sign-in',true);
await p.getByLabel('Passphrase').fill('fictional dev flow passphrase'); await p.getByRole('button',{name:'Sign in'}).click();
await p.getByRole('button',{name:'Choose folder'}).first().waitFor(); ok('signing in through the Vite proxy works',true);
const pdf=spawnSync(PY,['-I','-c','import sys;from pypdf import PdfWriter;w=PdfWriter();w.add_blank_page(612,792);w.write(sys.argv[1])',path.join(dir,'fictional.pdf')]); 
const folder=path.join(dir,'Fictional Folder'); fs.mkdirSync(folder); fs.copyFileSync(path.join(dir,'fictional.pdf'),path.join(folder,'fictional.pdf'));
const [ch]=await Promise.all([p.waitForEvent('filechooser'),p.getByRole('button',{name:'Choose folder'}).first().click()]); await ch.setFiles(folder);
await p.getByText('fictional.pdf').first().waitFor(); ok('importing through the Vite proxy works',true);
const docs=await (await c.request.get('http://127.0.0.1:5180/api/documents')).json(); ok('one document stored',docs.documents.length===1);
const content=await p.evaluate(async id=>{const r=await fetch('/api/documents/'+id+'/content');return [r.status,r.headers.get('content-type')];},docs.documents[0].id); ok('the page can fetch the PDF with its session',content[0]===200&&content[1]==='application/pdf',content.join(' '));
await p.goto('http://127.0.0.1:5180/#/documents'); await p.waitForSelector('main'); await sleep(1500); const frames=await p.locator('iframe,embed,object').count(); ok('documents screen opens',frames>=0,frames+' viewers');
await p.goto('http://127.0.0.1:5180/#/import'); await p.getByRole('heading',{name:'Sign-in'}).waitFor(); 
await p.getByRole('button',{name:'Sign out',exact:true}).click(); await p.getByRole('heading',{name:'Sign in to your archive'}).waitFor(); ok('sign out returns to sign-in and the session is gone',(await c.request.get('http://127.0.0.1:5180/api/documents')).status()===401);
await p.goto('http://127.0.0.1:5180/?demo#/overview'); await p.waitForSelector('main'); ok('the demo still opens while signed out',(await p.locator('body').innerText()).includes('DEMONSTRATION'));
ok('no outside requests',external.length===0,external.join()); ok('no page errors',errors.length===0,errors.slice(0,2).join(' | '));
await b.close(); be.kill(); process.kill(-vite.pid); fs.rmSync(dir,{recursive:true,force:true,maxRetries:3}); process.exit();
