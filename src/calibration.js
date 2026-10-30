'use strict';
const {EventEmitter}=require('events');const {randomUUID}=require('crypto');
const {IDENTITY,settings,analyze}=require('../remote/picture-math');
class Calibration extends EventEmitter {
  constructor({picture,window,pause=async()=>{},previewMs=120000,sessionMs=600000}={}){
    super();this.picture=picture;this.window=window;this.pause=pause;this.previewMs=previewMs;this.sessionMs=sessionMs;this.timer=null;this.queue=Promise.resolve();this.queued=0;this.before={...IDENTITY};this.display=null;
    this.expiredSession=null;
    this.state={active:false,phase:'idle',sessionId:'',busy:false,error:'',supported:null,adjustment:{...IDENTITY},profileSaved:false,previewUntil:null,view:'adjusted',analysis:null};
  }
  get active(){return this.state.active;}
  publish(patch={}){Object.assign(this.state,patch);this.emit('change',{...this.state});}
  enqueue(fn,urgent=false){if(!urgent&&this.queued>=8)return Promise.reject(new Error('Picture setup is busy.'));this.queued++;const task=this.queue.then(async()=>{this.publish({busy:true});try{return await fn();}catch(error){this.publish({error:error.message});throw error;}finally{this.queued--;this.publish({busy:false});}});this.queue=task.catch(()=>{});return task;}
  arm(ms){clearTimeout(this.timer);const id=this.state.sessionId;this.timer=setTimeout(()=>{if(this.state.sessionId===id&&this.active){this.expiredSession=id;this.cancel('Picture preview expired. Your previous settings were restored.',id).catch(()=>{});}},ms);this.timer.unref?.();}
  async start(display,bounds){return this.enqueue(async()=>{
    if(this.active)throw new Error('Picture setup is already open.');
    if(!display?.bounds)throw new Error('Connect the projector before calibrating.');
    this.expiredSession=null;this.display=display;this.publish({active:true,phase:'chart',sessionId:randomUUID(),error:'',analysis:null,previewUntil:null,supported:null,profileSaved:false});
    try{
      await this.pause();
      try{await this.picture.open(bounds);this.before={...this.picture.adjustment};await this.picture.preview(IDENTITY);this.publish({supported:true,adjustment:{...this.before},profileSaved:!!this.picture.saved});}
      catch(error){this.before={...IDENTITY};this.publish({supported:false,error:error.message,adjustment:{...IDENTITY}});}
      await this.window.show(display,{kind:'chart'});this.arm(this.sessionMs);
    }catch(error){this.window.close();this.publish({active:false,phase:'idle'});throw error;}
  });}
  async handle(message){return this.enqueue(async()=>{
    if(!this.active||message.sessionId!==this.state.sessionId||this.expiredSession===message.sessionId)throw new Error('This picture session expired. Start Calibrate again.');
    this.publish({error:this.state.supported===false?this.state.error:''});
    switch(message.action){
      case 'analyze':{
        const result=analyze(message.samples);this.publish({analysis:result,phase:'review'});this.arm(this.sessionMs);return;
      }
      case 'chart':if(this.state.supported)await this.picture.preview(IDENTITY);await this.window.show(this.display,{kind:'chart'});this.publish({phase:this.state.analysis?'review':'chart',previewUntil:null});this.arm(this.sessionMs);return;
      case 'preview':{
        if(!this.state.supported)throw new Error('Automatic output adjustment is unavailable. Use the test chart with your projector remote.');
        if(message.source==='camera-estimate'&&!this.state.analysis?.usable)throw new Error('Retake the chart photo before using a camera estimate.');
        const adjustment=settings(message.adjustment);
        if(message.source==='camera-estimate'&&JSON.stringify(adjustment)!==JSON.stringify(this.state.analysis.suggestion))throw new Error('The camera estimate changed. Analyze the chart again.');
        await this.picture.preview(adjustment);this.source=message.source;this.window.hide();this.publish({phase:'preview',adjustment,view:'adjusted',previewUntil:Date.now()+this.previewMs});this.arm(this.previewMs);return;
      }
      case 'compare':{
        if(this.state.phase!=='preview'||!['original','adjusted'].includes(message.view))throw new Error('Preview your adjustment first.');
        await this.picture.preview(message.view==='original'?IDENTITY:this.state.adjustment);this.window.hide();this.publish({view:message.view});return;
      }
      case 'save':{
        if(this.state.phase!=='preview'||!this.state.supported)throw new Error('Preview your adjustment before saving.');
        await this.picture.preview(this.state.adjustment);this.picture.save(this.state.adjustment,this.display.label,this.source);clearTimeout(this.timer);this.window.close();this.publish({active:false,phase:'saved',profileSaved:true,previewUntil:null,error:''});return;
      }
      default:throw new Error('Unknown picture setup action.');
    }
  });}
  async cancel(reason='',expectedSession=null){return this.enqueue(async()=>{
    if(expectedSession&&(!this.active||this.state.sessionId!==expectedSession))return;
    clearTimeout(this.timer);
    let restored=false;
    try{if(this.active&&this.state.supported)await this.picture.preview(this.before);restored=true;}
    finally{this.window.close();this.publish({active:false,phase:'idle',previewUntil:null,error:restored?reason:'Picture restore failed. Reconnect the projector and restart Lumen.',adjustment:{...this.before}});}
  },true);}
  async restoreProfile(display,bounds){return this.enqueue(async()=>{
    if(!this.picture.hasProfiles)return;
    await this.picture.open(bounds);this.publish({profileSaved:!!this.picture.saved,adjustment:{...this.picture.adjustment},error:'',supported:true});
  });}
  async reset(display,bounds){return this.enqueue(async()=>{
    if(this.active)throw new Error('Close picture setup before resetting the profile.');
    await this.picture.open(bounds);await this.picture.reset();this.publish({phase:'idle',profileSaved:false,adjustment:{...IDENTITY},error:''});
  });}
  async detach(){await this.cancel();await this.enqueue(async()=>{try{await this.picture.close();}finally{this.publish({supported:null,profileSaved:false,adjustment:{...IDENTITY}});}});}
}
module.exports={Calibration};
