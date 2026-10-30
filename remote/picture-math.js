'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LumenPictureMath=factory();})(typeof window==='object'?window:globalThis,function(){
  const IDENTITY=Object.freeze({red:1,green:1,blue:1,gamma:1});
  function settings(value){
    if(!value||typeof value!=='object')throw new Error('Choose valid picture settings.');
    const result={};
    for(const key of ['red','green','blue','gamma']){
      const number=value[key];const limits=key==='gamma'?[.85,1.2]:[.88,1.08];
      if(typeof number!=='number'||!Number.isFinite(number)||number<limits[0]||number>limits[1])throw new Error('Picture settings are outside the supported range.');
      result[key]=Math.round(number*1000)/1000;
    }
    return result;
  }
  function ramp(original,adjustment){
    const s=settings(adjustment);
    if(!Array.isArray(original)||original.length!==768||original.some(v=>!Number.isInteger(v)||v<0||v>65535))throw new Error('Invalid display baseline.');
    const result=[];
    for(let channel=0;channel<3;channel++)for(let i=0;i<256;i++){
      const position=Math.min(255,255*Math.pow(i/255,1/s.gamma));const lo=Math.floor(position),hi=Math.min(255,lo+1);
      const value=original[channel*256+lo]*(1-(position-lo))+original[channel*256+hi]*(position-lo);
      result.push(Math.round(Math.min(65535,value*s[['red','green','blue'][channel]])));
    }
    return result;
  }
  function patches(){
    const values=[0,24,48,80,112,144,184,216,240,255];
    const result=values.map((value,index)=>({id:'gray'+index,x:.075+index*.0944,y:.31,w:.073,h:.18,rgb:[value,value,value]}));
    const colors=[[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0]];
    return result.concat(colors.map((rgb,index)=>({id:'color'+index,x:.1+index*.16,y:.65,w:.12,h:.18,rgb})));
  }
  function homography(corners){
    if(!Array.isArray(corners)||corners.length!==4||corners.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Mark the four chart corners in order.');
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(corners.some((point,i)=>cross(point,corners[(i+1)%4],corners[(i+2)%4])<=0))throw new Error('Mark top left, top right, bottom right, then bottom left.');
    const unit=[[0,0],[1,0],[1,1],[0,1]];const rows=[];
    for(let i=0;i<4;i++){
      const [x,y]=unit[i],u=corners[i].x,v=corners[i].y;
      rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
    }
    for(let col=0;col<8;col++){
      let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const scale=rows[col][col];if(Math.abs(scale)<1e-9)throw new Error('The chart corners are too close together.');
      for(let k=col;k<9;k++)rows[col][k]/=scale;
      for(let row=0;row<8;row++)if(row!==col){const ratio=rows[row][col];for(let k=col;k<9;k++)rows[row][k]-=ratio*rows[col][k];}
    }
    const h=rows.map(row=>row[8]);
    return (x,y)=>{const d=h[6]*x+h[7]*y+1;if(Math.abs(d)<1e-8)throw new Error('Invalid chart perspective.');return {x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d};};
  }
  function samples(image,corners){
    if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||!image.data||image.data.length!==image.width*image.height*4)throw new Error('The photo could not be read.');
    const project=homography(corners);
    const side=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    if(Math.min(...corners.map((p,i)=>side(p,corners[(i+1)%4])))<100)throw new Error('Move closer so the chart occupies more of the photo.');
    return patches().map(patch=>{
      const values=[[],[],[]];let clipped=0;
      for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
        const p=project(patch.x+x*patch.w/16,patch.y+y*patch.h/16);const px=Math.round(p.x),py=Math.round(p.y);
        if(px<0||py<0||px>=image.width||py>=image.height)throw new Error('Keep all four chart corners inside the photo.');
        const offset=(py*image.width+px)*4;
        for(let c=0;c<3;c++)values[c].push(image.data[offset+c]);
        if(image.data[offset]>=253&&image.data[offset+1]>=253&&image.data[offset+2]>=253)clipped++;
      }
      const rgb=values.map(channel=>channel.slice().sort((a,b)=>a-b)[40]);
      const spread=Math.max(...values.map((channel,c)=>Math.sqrt(channel.reduce((sum,v)=>sum+(v-rgb[c])**2,0)/channel.length)));
      return {id:patch.id,rgb,spread,clipped:clipped/81};
    });
  }
  function analyze(readings){
    const expected=patches();
    if(!Array.isArray(readings)||readings.length!==expected.length||readings.some((v,i)=>v?.id!==expected[i].id||!Array.isArray(v.rgb)||v.rgb.length!==3||v.rgb.some(n=>!Number.isFinite(n)||n<0||n>255)||!Number.isFinite(v.spread)||v.spread<0||v.spread>255||!Number.isFinite(v.clipped)||v.clipped<0||v.clipped>1))throw new Error('The chart measurements are incomplete. Take another photo.');
    const grays=readings.slice(0,10),luma=grays.map(v=>v.rgb.reduce((a,b)=>a+b,0)/3);const reasons=[];
    if(luma[9]-luma[0]<90)reasons.push('The chart is too dim or has too little separation.');
    if(grays.slice(0,9).some(v=>v.clipped>.1)||grays[9].clipped>.35)reasons.push('The photo is overexposed. Lower the phone exposure and retake it.');
    if(luma.some((value,i)=>i>0&&value<luma[i-1]-4))reasons.push('The gray patches are out of order. Check the corner markers and reflections.');
    if(grays.slice(2,9).some(v=>v.spread>18))reasons.push('The chart has glare, texture or uneven lighting. Reposition the phone.');
    for(let c=0;c<3;c++){const rgb=readings[10+c].rgb;if(rgb[c]<Math.max(...rgb.filter((_,i)=>i!==c))+15)reasons.push('The colored patches do not match the chart. Check alignment.');}
    const usable=grays.slice(3,8).filter(v=>Math.min(...v.rgb)>30&&Math.max(...v.rgb)<245);
    let suggestion={...IDENTITY};
    if(!reasons.length&&usable.length>=3){
      const means=[0,1,2].map(c=>usable.reduce((sum,v)=>sum+v.rgb[c],0)/usable.length);
      const low=Math.min(...means);const keys=['red','green','blue'];
      for(let c=0;c<3;c++)suggestion[keys[c]]=Math.round(Math.max(.94,Math.min(1,low/means[c]))*1000)/1000;
    }
    return {usable:reasons.length===0,reasons:[...new Set(reasons)],suggestion,grayLevels:luma.map(Math.round),measurement:'Unverified phone camera',note:'This estimates the tint recorded by your camera. Its processing can change colors; compare the projected result before saving.'};
  }
  return {IDENTITY,settings,ramp,patches,homography,samples,analyze};
});
