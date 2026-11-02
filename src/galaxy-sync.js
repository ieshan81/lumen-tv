'use strict';
const {EventEmitter}=require('events');
function timeMinutes(value,fallback){const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));if(!match)return fallback;const h=Number(match[1]),m=Number(match[2]);return h<24&&m<60?h*60+m:fallback;}
function isNightAt(date,start='20:00',end='08:00'){
  const minute=date.getHours()*60+date.getMinutes(),from=timeMinutes(start,1200),until=timeMinutes(end,480);
  return from===until||from<until?(minute>=from&&minute<until):(minute>=from||minute<until);
}
class GalaxySync extends EventEmitter{
  constructor({ir,now=()=>Date.now(),missingGraceMs=20000,reassertMs=30*60000}={}){
    super();this.ir=ir;this.now=now;this.missingGraceMs=missingGraceMs;this.reassertMs=reassertMs;this.missingSince=0;this.lastDesired='';this.lastSentAt=0;this.task=null;
    this.overrideUntil=0;this.state={enabled:false,night:false,status:'idle',desired:null,lastSentAt:null,overrideUntil:null,error:'',start:'20:00',end:'08:00'};
  }
  publicState(){return{...this.state};}
  publish(update){Object.assign(this.state,update);this.emit('change',this.publicState());}
  async reconcile(projectorDetected,config={},force=false){
    if(this.task)return this.task;
    const enabled=config.enabled!==false,start=/^\d{2}:\d{2}$/.test(config.start||'')?config.start:'20:00',end=/^\d{2}:\d{2}$/.test(config.end||'')?config.end:'08:00';
    const now=this.now(),night=isNightAt(new Date(now),start,end);
    this.publish({enabled,night,start,end,error:''});
    if(!enabled||!night){this.missingSince=0;this.publish({status:'idle',desired:null});return this.publicState();}
    if(this.overrideUntil>now){this.publish({status:'manual',overrideUntil:this.overrideUntil});return this.publicState();}
    this.overrideUntil=0;
    if(projectorDetected)this.missingSince=0;else if(!this.missingSince)this.missingSince=now;
    if(!projectorDetected&&now-this.missingSince<this.missingGraceMs){this.publish({status:'waiting',desired:'on'});return this.publicState();}
    const desired=projectorDetected?'off':'on';
    if(!force&&desired===this.lastDesired&&now-this.lastSentAt<this.reassertMs){this.publish({status:'synced',desired,lastSentAt:this.lastSentAt});return this.publicState();}
    this.publish({status:'sending',desired});
    const task=(async()=>{try{await this.ir.pressNamed('Galaxy Projector',desired==='off'?'powerOff':'power');this.lastDesired=desired;this.lastSentAt=this.now();this.publish({status:'synced',desired,lastSentAt:this.lastSentAt,error:''});}catch(error){this.publish({status:'error',desired,error:String(error?.message||'Galaxy projector sync failed.').slice(0,180)});}return this.publicState();})();
    this.task=task;try{return await task;}finally{if(this.task===task)this.task=null;}
  }
  manual(desired,minutes=30){const now=this.now();this.lastDesired=desired;this.lastSentAt=now;this.overrideUntil=now+Math.max(1,minutes)*60000;this.publish({status:'manual',desired,lastSentAt:now,overrideUntil:this.overrideUntil,error:''});return this.publicState();}
  clearManual(){this.overrideUntil=0;this.publish({overrideUntil:null});}
}
module.exports={GalaxySync,isNightAt,timeMinutes};
