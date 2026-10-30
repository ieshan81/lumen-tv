'use strict';
const fs=require('fs');const path=require('path');const {spawn}=require('child_process');
const {IDENTITY,settings,ramp}=require('../remote/picture-math');
class PictureDriver {
  constructor(){this.child=null;this.pending=new Map();this.id=0;this.starting=null;}
  start(){
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','scripts','picture.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
      let buffer='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Windows picture control did not start.'));},15000);
      const fail=()=>{clearTimeout(timeout);if(this.child!==child)return;this.child=null;this.starting=null;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Windows picture control stopped.'));}this.pending.clear();reject(new Error('Windows picture control stopped.'));};
      child.on('error',fail);child.on('exit',fail);child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString();if(buffer.length>200000){child.kill();return;}
        let end;while((end=buffer.indexOf('\n'))>=0){let message;try{message=JSON.parse(buffer.slice(0,end));}catch{}buffer=buffer.slice(end+1);if(!message)continue;
          if(message.ready){clearTimeout(timeout);resolve();continue;}
          const item=this.pending.get(message.id);if(!item)continue;clearTimeout(item.timer);this.pending.delete(message.id);
          if(message.error)item.reject(new Error(String(message.error).slice(0,300)));else item.resolve(message.result);
        }
      });
    });return this.starting;
  }
  async command(cmd,data={}){
    await this.start();if(this.pending.size>=8)throw new Error('Picture control is busy.');
    return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Windows picture control did not respond.'));},10000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,cmd,...data})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('Windows picture control stopped.'));}});});
  }
  stop(){const child=this.child;this.child=null;this.starting=null;child?.stdin.end();}
}
class PictureController {
  constructor({root=path.join(__dirname,'..'),driver=new PictureDriver()}={}){
    this.root=root;this.driver=driver;this.snapshot=null;this.adjustment={...IDENTITY};
    this.file=path.join(root,'cache','picture-profiles.json');this.recovery=path.join(root,'cache','picture-recovery.json');this.profiles={};
    try{const stored=JSON.parse(fs.readFileSync(this.file,'utf8'));if(stored.version===1&&stored.profiles&&typeof stored.profiles==='object')this.profiles=stored.profiles;}catch{}
  }
  write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
  async recover(){
    if(!fs.existsSync(this.recovery))return;
    const snapshot=JSON.parse(fs.readFileSync(this.recovery,'utf8'));
    if(!snapshot.hardwareId||!Array.isArray(snapshot.ramp)||snapshot.ramp.length!==768||!Array.isArray(snapshot.applied)||snapshot.applied.length!==768)throw new Error('Earlier picture recovery data is invalid. Automatic tuning is disabled.');
    await this.driver.command('recover',{snapshot});fs.unlinkSync(this.recovery);
  }
  async open(bounds){
    if(this.snapshot)return;
    await this.recover();
    const snapshot=await this.driver.command('capture',{bounds});
    if(!snapshot?.hardwareId||!Array.isArray(snapshot.ramp)||snapshot.ramp.length!==768)throw new Error('Windows returned an invalid picture baseline.');
    this.snapshot=snapshot;this.adjustment={...IDENTITY};
    const saved=this.profiles[snapshot.hardwareId];
    if(saved)try{await this.preview(settings(saved.adjustment));}catch(error){this.adjustment={...IDENTITY};throw error;}
  }
  async preview(value){
    if(!this.snapshot)throw new Error('Start projector picture setup first.');
    const adjustment=settings(value),values=ramp(this.snapshot.ramp,adjustment);
    this.write(this.recovery,{...this.snapshot,applied:values,previousApplied:ramp(this.snapshot.ramp,this.adjustment)});
    await this.driver.command('apply',{ramp:values});this.adjustment=adjustment;return adjustment;
  }
  save(value,label,source='manual'){
    const adjustment=settings(value);if(!this.snapshot)throw new Error('The projector is no longer available.');
    const profile={adjustment,label:String(label||'Projector').slice(0,120),source:source==='camera-estimate'?'camera-estimate':'manual',savedAt:new Date().toISOString()};
    const next={...this.profiles,[this.snapshot.hardwareId]:profile};this.write(this.file,{version:1,profiles:next});this.profiles=next;return profile;
  }
  get saved(){return this.snapshot?this.profiles[this.snapshot.hardwareId]||null:null;}
  get hasProfiles(){return Object.keys(this.profiles).length>0;}
  async reset(){
    if(!this.snapshot)throw new Error('Start projector picture setup first.');
    await this.preview(IDENTITY);const next={...this.profiles};delete next[this.snapshot.hardwareId];this.write(this.file,{version:1,profiles:next});this.profiles=next;
  }
  async close(){
    try{if(this.snapshot){await this.driver.command('release');if(fs.existsSync(this.recovery))fs.unlinkSync(this.recovery);}}
    finally{this.snapshot=null;this.adjustment={...IDENTITY};this.driver.stop();}
  }
}
module.exports={PictureDriver,PictureController};
