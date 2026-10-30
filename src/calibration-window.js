'use strict';
const path=require('path');
class CalibrationWindow {
  constructor({createWindow}={}){this.createWindow=createWindow||((options)=>new(require('electron').BrowserWindow)(options));this.win=null;this.pending=null;this.ready=false;}
  async show(display,state){
    if(!display?.bounds)throw new Error('Connect the projector before calibrating.');
    this.bounds={...display.bounds};
    this.pending=state;
    if(this.win&&!this.win.isDestroyed()){this.win.setBounds(display.bounds);this.present();return;}
    const win=this.createWindow({...display.bounds,show:false,frame:false,skipTaskbar:true,focusable:false,resizable:false,backgroundColor:'#101018',title:'Lumen picture setup',webPreferences:{preload:path.join(__dirname,'..','ui','picture-preload.js'),sandbox:true,contextIsolation:true}});
    this.win=win;this.ready=false;win.setIgnoreMouseEvents(true);win.setMenuBarVisibility(false);win.setAlwaysOnTop(true,'screen-saver');
    win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.on('closed',()=>{if(this.win===win){this.win=null;this.ready=false;}});
    await win.loadFile(path.join(__dirname,'..','ui','picture.html'));
    if(this.win===win&&!win.isDestroyed()){this.ready=true;this.present();}
  }
  present(){if(!this.ready||!this.win||this.win.isDestroyed())return;this.win.webContents.send('picture',this.pending);this.win.setBounds(this.bounds);this.win.setFullScreen(true);this.win.showInactive();this.win.moveTop();}
  hide(){if(this.win&&!this.win.isDestroyed())this.win.hide();}
  close(){this.pending=null;if(this.win&&!this.win.isDestroyed())this.win.destroy();this.win=null;this.ready=false;}
}
module.exports={CalibrationWindow};
