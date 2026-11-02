'use strict';
const {EventEmitter}=require('events');
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const hex=value=>clamp(Math.round(value),0,255).toString(16).padStart(2,'0');
function enhance({r,g,b}){
  const mean=(r+g+b)/3,saturation=1.3;
  r=mean+(r-mean)*saturation;g=mean+(g-mean)*saturation;b=mean+(b-mean)*saturation;
  const peak=Math.max(r,g,b),gain=peak>0?clamp(190/peak,1,1.5):1;
  return`#${hex(r*gain)}${hex(g*gain)}${hex(b*gain)}`;
}
function averagePatch(bitmap,width,height,x,y,radius=3){
  let r=0,g=0,b=0,count=0,luma=0;
  for(let py=Math.max(0,Math.round(y)-radius);py<=Math.min(height-1,Math.round(y)+radius);py++)for(let px=Math.max(0,Math.round(x)-radius);px<=Math.min(width-1,Math.round(x)+radius);px++){
    const offset=(py*width+px)*4,blue=bitmap[offset],green=bitmap[offset+1],red=bitmap[offset+2],alpha=bitmap[offset+3];
    if(alpha<16)continue;r+=red;g+=green;b+=blue;luma+=(red*.2126+green*.7152+blue*.0722);count++;
  }
  return count?{r:r/count,g:g/count,b:b/count,luma:luma/count}:null;
}
function sampleZones(bitmap,width,height,points){
  if(!Buffer.isBuffer(bitmap)||bitmap.length<width*height*4||!Array.isArray(points)||points.length!==4)return null;
  const center=points.reduce((out,p)=>({x:out.x+p.x/4,y:out.y+p.y/4}),{x:0,y:0}),zones=[];
  for(let edge=0;edge<4;edge++){
    const a=points[edge],b=points[(edge+1)%4];
    for(const t of [.18,.5,.82]){
      const edgePoint={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      const sample={x:edgePoint.x+(center.x-edgePoint.x)*.055,y:edgePoint.y+(center.y-edgePoint.y)*.055};
      const color=averagePatch(bitmap,width,height,sample.x*width,sample.y*height);
      if(!color)return null;zones.push({...color,edge,t});
    }
  }
  const lit=zones.filter(zone=>zone.luma>7);
  if(lit.length<4||lit.reduce((sum,zone)=>sum+zone.luma,0)/lit.length<12)return null;
  return zones.map(zone=>({edge:zone.edge,t:zone.t,color:enhance(zone)}));
}
function mixHex(previous,next,amount=.36){
  if(!/^#[0-9a-f]{6}$/i.test(previous||''))return next;
  const channel=(value,shift)=>parseInt(value.slice(1+shift,3+shift),16);
  return`#${[0,2,4].map(shift=>hex(channel(previous,shift)*(1-amount)+channel(next,shift)*amount)).join('')}`;
}
class AmbientSampler extends EventEmitter{
  constructor({capture,interval=260}={}){super();this.capture=capture||this.captureDisplay.bind(this);this.interval=interval;this.timer=null;this.generation=0;this.zones=[];this.status='off';this.error='';}
  async captureDisplay(display){
    const {desktopCapturer}=require('electron');
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:320,height:180},fetchWindowIcons:false});
    const source=sources.find(item=>String(item.display_id)===String(display.id))||sources.find(item=>item.id===`screen:${display.id}:0`);
    if(!source||source.thumbnail.isEmpty())throw new Error('Projector picture capture is unavailable.');
    const size=source.thumbnail.getSize(),bitmap=source.thumbnail.toBitmap();
    return{bitmap,width:size.width,height:size.height};
  }
  start(display,points){
    this.stop(false);this.display=display;this.points=points.map(point=>({...point}));this.status='starting';this.error='';const generation=++this.generation;
    const tick=async()=>{
      try{
        const image=await this.capture(this.display),next=sampleZones(image.bitmap,image.width,image.height,this.points);
        if(next){const changed=this.status!=='live';this.zones=next.map((zone,index)=>({...zone,color:mixHex(this.zones[index]?.color,zone.color)}));this.status='live';this.error='';this.emit('zones',this.zones);if(changed)this.emit('status',this.state());}
        else{const message='Protected or black video cannot be sampled; using the app color.',changed=this.status!=='fallback'||this.error!==message;this.status='fallback';this.error=message;if(changed)this.emit('status',this.state());}
      }catch(error){const message=String(error?.message||error),changed=this.status!=='fallback'||this.error!==message;this.status='fallback';this.error=message;if(changed)this.emit('status',this.state());}
      if(this.generation===generation)this.timer=setTimeout(tick,this.interval);
    };
    tick();
  }
  startStream(display,points){
    this.stop(false);this.display=display;this.points=points.map(point=>({...point}));this.status='starting';this.error='';this.zones=[];this.emit('status',this.state());
  }
  acceptStreamState(value={}){
    if(!['live','fallback'].includes(value.status)||this.status==='off')return false;
    const error=value.status==='fallback'?String(value.error||'Projector picture capture is unavailable.') : '';
    const changed=this.status!==value.status||this.error!==error;
    this.status=value.status;this.error=error;
    if(changed)this.emit('status',this.state());
    return changed;
  }
  updatePoints(points){this.points=points.map(point=>({...point}));}
  stop(reset=true){clearTimeout(this.timer);this.timer=null;this.generation++;if(reset){this.status='off';this.error='';this.zones=[];}}
  state(){return{status:this.status,error:this.error,zones:this.zones};}
}
module.exports={sampleZones,mixHex,AmbientSampler};
