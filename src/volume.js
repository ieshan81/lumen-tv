'use strict';
const {EventEmitter}=require('events');
const {spawn}=require('child_process');
const path=require('path');
class VolumeMonitor extends EventEmitter {
  constructor({spawnWorker,interval=350}={}){
    super();this.spawnWorker=spawnWorker||(()=>spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','scripts','volume.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']}));
    this.interval=interval;this.worker=null;this.ready=false;this.pending=new Map();this.nextId=0;this.state=null;this.poll=null;this.reading=null;this.starting=null;
  }
  start(){
    if(this.starting)return this.starting;
    if(this.ready)return Promise.resolve();
    this.starting=new Promise((resolve,reject)=>{
      this.startReject=reject;
      const worker=this.spawnWorker();this.worker=worker;let buffer='';
      const timeout=setTimeout(()=>{reject(new Error('Windows volume service did not start.'));this.stop();},12000);
      const fail=()=>{clearTimeout(timeout);if(this.worker!==worker)return;this.ready=false;this.starting=null;this.startReject=null;this.worker=null;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Windows volume service stopped.'));}this.pending.clear();reject(new Error('Windows volume service stopped.'));};
      worker.on('error',fail);worker.on('exit',fail);worker.stderr.on('data',()=>{});
      worker.stdin.on('error',()=>{});
      worker.stdout.on('data',chunk=>{
        buffer+=chunk.toString();if(buffer.length>65536){buffer='';return;}
        let index;
        while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let result;try{result=JSON.parse(line);}catch{continue;}
          if(result.ready){clearTimeout(timeout);this.ready=true;this.starting=null;this.startReject=null;resolve();continue;}
          const pending=this.pending.get(result.id);if(!pending)continue;
          clearTimeout(pending.timer);this.pending.delete(result.id);
          if(result.error){pending.reject(new Error(result.error));continue;}
          const value=result.state;
          if(!value||!Number.isFinite(value.percent)||value.percent<0||value.percent>100||typeof value.muted!=='boolean'){pending.reject(new Error('Invalid Windows volume state.'));continue;}
          const state={percent:value.percent,muted:value.muted,name:String(value.name||'Windows audio').slice(0,120),deviceId:String(value.deviceId||'')};
          const changed=JSON.stringify(state)!==JSON.stringify(this.state);this.state=state;
          this.emit('snapshot',state);
          if(changed)this.emit('change',state);
          pending.resolve(state);
        }
      });
    });return this.starting;
  }
  async command(cmd='read'){
    if(!['read','up','down','mute'].includes(cmd))throw new Error('Invalid volume command.');
    await this.start();if(this.pending.size>=32)throw new Error('Volume control is busy.');
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Windows volume did not respond.'));},3000);
      this.pending.set(id,{resolve,reject,timer});
      this.worker.stdin.write(JSON.stringify({id,cmd})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('Windows volume service stopped.'));}});
    });
  }
  read(){if(!this.reading)this.reading=this.command('read').finally(()=>{this.reading=null;});return this.reading;}
  watch(){if(this.poll)return;const read=()=>this.read().catch(error=>this.emit('unavailable',error));read();this.poll=setInterval(read,this.interval);}
  stop(){clearInterval(this.poll);this.poll=null;this.ready=false;this.state=null;this.starting=null;this.startReject?.(new Error('Volume service stopped.'));this.startReject=null;const worker=this.worker;this.worker=null;if(worker){worker.stdin.end();worker.kill();}for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Volume service stopped.'));}this.pending.clear();}
}
module.exports={VolumeMonitor};
