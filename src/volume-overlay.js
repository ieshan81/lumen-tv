'use strict';
const path=require('path');
const {EventEmitter}=require('events');
function overlayBounds(bounds){
  const width=Math.min(480,Math.max(240,bounds.width-32));const height=110;
  return {x:Math.round(bounds.x+(bounds.width-width)/2),y:Math.round(bounds.y+bounds.height-height-Math.min(56,bounds.height*.06)),width,height};
}
class VolumeOverlay extends EventEmitter {
  constructor({createWindow,timeout=1900,autoHide=true}={}){super();this.createWindow=createWindow||((options)=>new(require('electron').BrowserWindow)(options));this.timeout=timeout;this.autoHide=autoHide;this.win=null;this.timer=null;this.pending=null;this.ready=false;}
  setAutoHide(value){this.autoHide=value!==false;clearTimeout(this.timer);if(this.autoHide&&this.visible)this.timer=setTimeout(()=>this.hide(),this.timeout);}
  get visible(){return !!this.win&&!this.win.isDestroyed()&&this.win.isVisible();}
  show(display,state){
    if(!display?.bounds)return;
    const bounds=overlayBounds(display.bounds);
    this.pending=state||{available:false};
    if(!this.win||this.win.isDestroyed()){
      const win=this.createWindow({...bounds,show:false,frame:false,transparent:true,focusable:false,skipTaskbar:true,resizable:false,movable:false,hasShadow:false,alwaysOnTop:true,backgroundColor:'#00000000',title:'Lumen volume',webPreferences:{preload:path.join(__dirname,'..','ui','volume-preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
      this.win=win;this.ready=false;
      win.setIgnoreMouseEvents(true,{forward:true});win.setAlwaysOnTop(true,'screen-saver');
      win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      win.webContents.once('did-finish-load',()=>{if(this.win===win){this.ready=true;this.present();}});
      win.on('closed',()=>{if(this.win===win){this.win=null;this.ready=false;}});
      win.loadFile(path.join(__dirname,'..','ui','volume.html'));
    }else{this.win.setBounds(bounds);this.present();}
  }
  present(){
    if(!this.ready||!this.win||this.win.isDestroyed()||!this.pending)return;
    const wasVisible=this.visible;
    this.win.webContents.send('volume',this.pending);this.win.showInactive();this.win.moveTop();
    if(!wasVisible)this.emit('visibility',true);
    clearTimeout(this.timer);if(this.autoHide)this.timer=setTimeout(()=>this.hide(),this.timeout);
  }
  hide(){clearTimeout(this.timer);this.pending=null;const wasVisible=this.visible;if(this.win&&!this.win.isDestroyed())this.win.hide();if(wasVisible)this.emit('visibility',false);}
  close(){this.hide();if(this.win&&!this.win.isDestroyed())this.win.destroy();this.win=null;this.ready=false;}
}
module.exports={VolumeOverlay,overlayBounds};
