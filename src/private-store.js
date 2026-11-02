'use strict';
const fs=require('fs');const path=require('path');const {spawn}=require('child_process');
function transform(mode,value){
  if(process.platform!=='win32')return Promise.reject(new Error('Private credentials require Windows account protection.'));
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','scripts','private-data.ps1'),mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Private credential storage timed out.'));},15000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>200000)child.kill();});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Private credential storage is unavailable.'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(new Error('Windows could not protect or unlock Lumen credentials.'));});
    child.stdin.end(value);
  });
}
async function writeSecret(file,value){const data=await transform('seal',JSON.stringify(value));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,protection:'Windows CurrentUser DPAPI',data})+'\n',{mode:0o600});fs.renameSync(file+'.tmp',file);}
async function readSecret(file){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.version!==1||saved.protection!=='Windows CurrentUser DPAPI'||typeof saved.data!=='string')throw new Error('Private credentials have an unsupported format.');return JSON.parse(await transform('unseal',saved.data));}
module.exports={writeSecret,readSecret};
