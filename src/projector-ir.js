'use strict';
const path=require('path');
const {EventEmitter}=require('events');
const {readSecret,writeSecret}=require('./private-store');
const {TuyaCloud}=require('./tuya-cloud');

const CREDENTIALS=path.join(__dirname,'..','cache','tuya','connection.json');
const ALIASES=Object.freeze({
  power:['on','power','power on'],powerOff:['off','power off'],source:['source','input','hdmi'],home:['home'],settings:['settings','menu'],
  up:['up'],down:['down'],left:['left'],right:['right'],ok:['ok','enter','select'],back:['back','return'],
  focus:['focus'],volumeDown:['vol down','volume down','vol-'],volumeUp:['vol up','volume up','vol+'],mute:['mute'],
  info:['info'],youtube:['youtube'],netflix:['netflix'],prime:['prime']
});
const LABELS=Object.freeze({power:'Power',powerOff:'Power off',source:'Input',home:'Home',settings:'Settings',up:'Up',down:'Down',left:'Left',right:'Right',ok:'OK',back:'Back',focus:'Focus',volumeDown:'Volume down',volumeUp:'Volume up',mute:'Mute',info:'Info',youtube:'YouTube',netflix:'Netflix',prime:'Prime Video'});
const normalize=value=>String(value||'').trim().toLowerCase();
function mapKeys(list){
  const byName=new Map((list||[]).map(key=>[normalize(key.key_name),key]));
  const buttons=[];
  for(const [id,names] of Object.entries(ALIASES)){
    const key=names.map(name=>byName.get(name)).find(Boolean);if(!key)continue;
    if(!Number.isSafeInteger(Number(key.key_id))||!String(key.key||''))continue;
    buttons.push({id,label:LABELS[id],keyId:Number(key.key_id),key:String(key.key)});
  }
  return buttons;
}
function scoreRemote(remote,buttons){
  const names=new Set(buttons.map(button=>button.id));
  let score=['power','source','up','down','left','right','ok','back'].reduce((n,id)=>n+(names.has(id)?2:0),0);
  if(/projector|tv|other/i.test(remote.remote_name||''))score+=1;
  if(/galaxy|nebula|lamp|ac/i.test(`${remote.remote_name||''} ${remote.brand_name||''}`))score-=12;
  return score;
}
function shouldUseIrVolume({volume,audioDevices=[],projector={}}={}){
  const active=audioDevices.find(device=>device.id===volume?.deviceId)||audioDevices.find(device=>device.isDefault);
  const name=normalize(active?.name||volume?.name);
  if(!name)return false;
  const identities=[projector.match,projector.label,...(Array.isArray(projector.aliases)?projector.aliases:[])].map(normalize).filter(value=>value.length>=2);
  if(identities.some(value=>name.includes(value)))return true;
  return /\b(hdmi|display audio|high definition audio)\b/.test(name)&&!/headphone|headset|speaker|bluetooth|soundcore|airpod/.test(name);
}
class ProjectorIr extends EventEmitter{
  constructor({credentialsFile=CREDENTIALS,read=readSecret,write=writeSecret,clientFactory=c=>new TuyaCloud(c)}={}){
    super();this.credentialsFile=credentialsFile;this.read=read;this.write=write;this.clientFactory=clientFactory;this.api=null;this.credentials=null;this.targets=new Map();this.queue=Promise.resolve();
    this.state={configured:false,status:'loading',hubName:'',remoteName:'',remotes:[],buttons:[],busy:false,error:'',lastAcceptedAt:null,lastButton:''};
  }
  publicState(){return{...this.state,remotes:this.state.remotes.map(x=>({...x})),buttons:this.state.buttons.map(x=>({...x}))};}
  publish(update){Object.assign(this.state,update);this.emit('change',this.publicState());}
  async refresh(){
    this.publish({status:'loading',error:''});
    try{
      this.credentials=await this.read(this.credentialsFile);this.api=this.clientFactory(this.credentials);
      const remotes=await this.api.remotes(this.credentials.hubId);const candidates=[];
      for(const remote of remotes.filter(item=>Number(item.category_id)!==5)){
        let detail;try{detail=await this.api.keys(this.credentials.hubId,remote.remote_id);}catch{continue;}
        const buttons=mapKeys(detail?.key_list);if(buttons.length)candidates.push({remote,buttons,score:scoreRemote(remote,buttons)});
      }
      candidates.sort((a,b)=>b.score-a.score);
      let selected=candidates.find(x=>x.remote.remote_id===this.credentials.remoteId);
      if(!selected&&candidates[0]?.score>=10)selected=candidates[0];
      this.targets.clear();for(const item of candidates)this.targets.set(String(item.remote.remote_id),item);
      if(selected&&selected.remote.remote_id!==this.credentials.remoteId){this.credentials.remoteId=selected.remote.remote_id;this.credentials.remoteName=selected.remote.remote_name;await this.write(this.credentialsFile,this.credentials);}
      this.applySelection(selected);
    }catch(error){this.publish({configured:false,status:'error',error:this.friendly(error),buttons:[],remotes:[]});}
    return this.publicState();
  }
  applySelection(selected){
    const remotes=[...this.targets.values()].filter(x=>x.score>=4).map(x=>({id:String(x.remote.remote_id),name:String(x.remote.remote_name||'Saved remote'),selected:x===selected}));
    this.active=selected||null;
    this.publish({configured:!!selected,status:selected?'ready':'needs-selection',hubName:String(this.credentials?.hubName||'Tuya IR hub'),remoteName:String(selected?.remote.remote_name||''),remotes,buttons:(selected?.buttons||[]).map(({id,label})=>({id,label})),error:selected?'':'Choose the saved remote that controls the projector.'});
  }
  async select(remoteId){
    const selected=this.targets.get(String(remoteId));if(!selected)throw new Error('That saved IR remote is unavailable.');
    this.credentials.remoteId=selected.remote.remote_id;this.credentials.remoteName=selected.remote.remote_name;await this.write(this.credentialsFile,this.credentials);this.applySelection(selected);return this.publicState();
  }
  async press(buttonId){
    if(!this.active||!this.api)throw new Error('Projector IR is not ready yet.');
    const button=this.active.buttons.find(item=>item.id===buttonId);if(!button)throw new Error('That projector button is unavailable.');
    if(this.state.busy)throw new Error('Wait for the previous projector command.');
    this.publish({busy:true,error:''});
    try{
      const accepted=await this.api.rawCommand(this.credentials.hubId,this.active.remote.remote_id,{category_id:Number(this.active.remote.category_id),key_id:button.keyId,key:button.key});
      if(accepted!==true)throw new Error('Tuya did not accept the IR command.');
      this.publish({status:'ready',busy:false,lastAcceptedAt:Date.now(),lastButton:button.label});return true;
    }catch(error){this.publish({status:'error',busy:false,error:this.friendly(error)});throw new Error(this.friendly(error));}
  }
  async pressNamed(remoteName,buttonId){
    const target=[...this.targets.values()].find(item=>normalize(item.remote.remote_name)===normalize(remoteName));
    if(!target||!this.api)throw new Error(`${remoteName} is unavailable on the Tuya IR hub.`);
    const button=target.buttons.find(item=>item.id===buttonId);if(!button)throw new Error(`${remoteName} does not have that command.`);
    const accepted=await this.api.rawCommand(this.credentials.hubId,target.remote.remote_id,{category_id:Number(target.remote.category_id),key_id:button.keyId,key:button.key});
    if(accepted!==true)throw new Error('Tuya did not accept the accessory IR command.');
    return{remoteName:String(target.remote.remote_name),button:button.label,acceptedAt:Date.now()};
  }
  friendly(error){const text=String(error?.message||'Projector IR is unavailable.');if(/credentials|ENOENT/i.test(text))return 'Tuya IR is not configured on this laptop.';if(/could not be reached/i.test(text))return 'Tuya IR is offline. Check the laptop internet connection.';return text.replace(/^Tuya \S+:\s*/,'').slice(0,180);}
}
module.exports={ProjectorIr,mapKeys,scoreRemote,shouldUseIrVolume};
