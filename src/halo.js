'use strict';
const path=require('path');
const MODES=new Set(['app','cinema','warm']);
const DEFAULT_POINTS=Object.freeze([
  Object.freeze({x:.08,y:.08}),Object.freeze({x:.92,y:.08}),
  Object.freeze({x:.92,y:.92}),Object.freeze({x:.08,y:.92})
]);
const DEFAULT_HALO=Object.freeze({enabled:false,alwaysOn:true,mode:'app',intensity:.35,points:DEFAULT_POINTS});
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function finite(value,fallback,min,max){return Number.isFinite(value)?clamp(value,min,max):fallback;}
function pointsFromFrame(frame={}){
  const left=finite(frame.left,.08,0,.3),top=finite(frame.top,.08,0,.3),right=finite(frame.right,.08,0,.3),bottom=finite(frame.bottom,.08,0,.3);
  return [{x:left,y:top},{x:1-right,y:top},{x:1-right,y:1-bottom},{x:left,y:1-bottom}];
}
function signedArea(points){return points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p.x*next.y-next.x*p.y;},0)/2;}
function validQuad(points){
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<.01||p.x>.99||p.y<.01||p.y>.99))return false;
  if(Math.abs(signedArea(points))<.12)return false;
  const crosses=points.map((p,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return(b.x-p.x)*(c.y-b.y)-(b.y-p.y)*(c.x-b.x);});
  return crosses.every(value=>value>.002)||crosses.every(value=>value<-.002);
}
function normalizeHalo(value={}){
  value=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const requested=Array.isArray(value.points)?value.points.map((p,i)=>({x:finite(p?.x,DEFAULT_POINTS[i].x,.01,.99),y:finite(p?.y,DEFAULT_POINTS[i].y,.01,.99)})):pointsFromFrame(value.frame);
  const points=validQuad(requested)?requested:DEFAULT_POINTS.map(point=>({...point}));
  return{enabled:value.enabled===true,alwaysOn:value.alwaysOn!==false,mode:MODES.has(value.mode)?value.mode:'app',intensity:finite(value.intensity,.35,.04,1),points};
}
function parseHalo(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||(value.alwaysOn!=null&&typeof value.alwaysOn!=='boolean')||!MODES.has(value.mode)||!Number.isFinite(value.intensity)||value.intensity<.04||value.intensity>1)throw new Error('Choose valid Halo settings.');
  const points=Array.isArray(value.points)?value.points:pointsFromFrame(value.frame);
  if(!validQuad(points))throw new Error('Keep all four screen corners in order and inside the projector area.');
  return normalizeHalo({...value,points});
}
function pointPixels(bounds,value){const halo=normalizeHalo(value);return halo.points.map(point=>({x:Math.round(bounds.x+bounds.width*point.x),y:Math.round(bounds.y+bounds.height*point.y)}));}
function quadBounds(bounds,value){
  const points=pointPixels(bounds,value),xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);
  return{x,y,width:Math.max(320,right-x),height:Math.max(180,bottom-y)};
}
function contentBounds(bounds,value){return quadBounds(bounds,value);}
function nudgePoint(value,index,dx,dy){
  if(!Number.isInteger(index)||index<0||index>3||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>.03||Math.abs(dy)>.03)throw new Error('Invalid corner movement.');
  const halo=normalizeHalo(value),points=halo.points.map(point=>({...point}));
  points[index]={x:clamp(points[index].x+dx,.01,.99),y:clamp(points[index].y+dy,.01,.99)};
  if(!validQuad(points))throw new Error('That move would fold or collapse the screen frame.');
  return{...halo,points};
}
function safeAccent(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:'#8b7cff';}
function haloColor(value,accent){const mode=normalizeHalo(value).mode;return mode==='warm'?'#ffad66':mode==='cinema'?'#536dff':safeAccent(accent);}
function projectiveMatrix(value,width,height){
  const p=normalizeHalo(value).points.map(point=>({x:point.x*width,y:point.y*height})),[p0,p1,p2,p3]=p;
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  const denominator=dx1*dy2-dx2*dy1;
  if(Math.abs(denominator)<1e-8)throw new Error('Screen corners cannot form a perspective surface.');
  const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
  const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x,c=p0.x;
  const d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y,f=p0.y;
  const matrix=[a/width,d/width,0,g/width,b/height,e/height,0,h/height,0,0,1,0,c,f,0,1];
  return{matrix,css:`matrix3d(${matrix.map(number=>Number(number.toFixed(10))).join(',')})`};
}
class HaloController{
  constructor({createWindow,getSources}={}){this.createWindow=createWindow||((options)=>new(require('electron').BrowserWindow)(options));this.getSources=getSources||(createWindow?null:(options)=>require('electron').desktopCapturer.getSources(options));this.win=null;this.ready=false;this.pending=null;this.guide=false;this.zones=[];this.captureDisplayId=null;this.captureSourceId='';this.captureError='';this.captureGeneration=0;this.captureResolving=false;}
  get visible(){return !!this.win&&!this.win.isDestroyed()&&this.win.isVisible();}
  show(display,value,{accent='#8b7cff',guide=this.guide,zones=this.zones,dynamic='fallback',selected=0,maskOutside=true}={}){
    if(!display?.bounds)return;const halo=normalizeHalo(value);this.guide=!!guide;this.zones=Array.isArray(zones)?zones:[];this.bounds={...display.bounds};
    const local={x:0,y:0,width:this.bounds.width,height:this.bounds.height};
    if(this.captureDisplayId!==display.id){this.captureDisplayId=display.id;this.captureSourceId='';this.captureError='';this.captureGeneration++;this.captureResolving=false;}
    this.pending={enabled:halo.enabled,guide:this.guide,intensity:halo.intensity,color:haloColor(halo,accent),points:pointPixels(local,halo),zones:this.zones,dynamic,selected:Number.isInteger(selected)?selected:0,maskOutside:!!maskOutside,captureSourceId:this.captureSourceId,captureError:this.captureError};
    if(!this.win||this.win.isDestroyed()){
      const win=this.createWindow({...this.bounds,show:false,frame:false,transparent:true,focusable:false,skipTaskbar:true,resizable:false,movable:false,hasShadow:false,alwaysOnTop:true,backgroundColor:'#00000000',title:'Lumen Halo',webPreferences:{preload:path.join(__dirname,'..','ui','halo-preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
      this.win=win;this.ready=false;win.setIgnoreMouseEvents(true,{forward:false});win.setMenuBarVisibility(false);win.setContentProtection?.(true);
      win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      win.webContents.once('did-finish-load',()=>{if(this.win===win){this.ready=true;this.present();}});win.on('closed',()=>{if(this.win===win){this.win=null;this.ready=false;}});
      win.loadFile(path.join(__dirname,'..','ui','halo.html'));
    }else{this.win.setBounds(this.bounds);this.present();}
    if(halo.enabled&&!this.captureSourceId&&!this.captureError)this.resolveCaptureSource(display.id);
  }
  async resolveCaptureSource(displayId){
    if(!this.getSources||this.captureResolving)return;
    this.captureResolving=true;const generation=++this.captureGeneration;
    try{
      const sources=await this.getSources({types:['screen'],thumbnailSize:{width:1,height:1},fetchWindowIcons:false});
      if(generation!==this.captureGeneration||displayId!==this.captureDisplayId)return;
      const source=sources.find(item=>String(item.display_id)===String(displayId))||sources.find(item=>item.id===`screen:${displayId}:0`);
      if(!source)throw new Error('Projector capture source is unavailable.');
      this.captureSourceId=source.id;this.captureError='';
    }catch(error){
      if(generation!==this.captureGeneration)return;
      this.captureSourceId='';this.captureError=String(error?.message||error);
    }
    this.captureResolving=false;
    if(this.pending){this.pending={...this.pending,captureSourceId:this.captureSourceId,captureError:this.captureError};this.present();}
  }
  present(){
    if(!this.ready||!this.win||this.win.isDestroyed()||!this.pending)return;
    this.win.webContents.send('halo',this.pending);this.win.showInactive();this.win.setAlwaysOnTop(true,'screen-saver');this.win.moveTop();
  }
  setGuide(value){this.guide=!!value;if(this.pending){this.pending={...this.pending,guide:this.guide};this.present();}}
  hide(){this.pending=null;this.guide=false;this.zones=[];this.captureGeneration++;this.captureResolving=false;this.captureDisplayId=null;this.captureSourceId='';this.captureError='';if(this.win&&!this.win.isDestroyed()){if(this.ready)this.win.webContents.send('halo-stop');this.win.hide();}}
  close(){this.hide();if(this.win&&!this.win.isDestroyed())this.win.destroy();this.win=null;this.ready=false;}
}
module.exports={DEFAULT_HALO,DEFAULT_POINTS,normalizeHalo,parseHalo,validQuad,pointPixels,quadBounds,contentBounds,nudgePoint,haloColor,projectiveMatrix,HaloController};
