'use strict';
function draw(){
  const canvas=document.querySelector('#chart');const ratio=devicePixelRatio||1;canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);const w=innerWidth,h=innerHeight,x=w*.12,y=h*.18,cw=w*.76,ch=h*.66;
  ctx.fillStyle='#101018';ctx.fillRect(0,0,w,h);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font=`600 ${Math.max(20,h*.032)}px Segoe UI`;ctx.fillText('LUMEN · PICTURE SETUP',w/2,h*.075);
  ctx.fillStyle='#aeb2c5';ctx.font=`${Math.max(14,h*.021)}px Segoe UI`;ctx.fillText('Photograph the chart, then mark crosses 1 → 2 → 3 → 4 on your phone.',w/2,h*.12);
  ctx.strokeStyle='#7b7b85';ctx.lineWidth=2;ctx.strokeRect(x,y,cw,ch);
  for(const patch of window.LumenPictureMath.patches()){
    ctx.fillStyle=`rgb(${patch.rgb.join(',')})`;ctx.fillRect(x+(patch.x-patch.w/2)*cw,y+(patch.y-patch.h/2)*ch,patch.w*cw,patch.h*ch);
    ctx.fillStyle='#b3b3be';ctx.font=`${Math.max(12,h*.016)}px Segoe UI`;ctx.fillText(patch.id.startsWith('gray')?String(patch.rgb[0]):['RED','GREEN','BLUE','CYAN','MAGENTA','YELLOW'][Number(patch.id.slice(5))],x+patch.x*cw,y+(patch.y+patch.h/2)*ch+h*.03);
  }
  [[0,0],[1,0],[1,1],[0,1]].forEach(([px,py],i)=>{
    const cx=x+px*cw,cy=y+py*ch;ctx.fillStyle='#000';ctx.fillRect(cx-22,cy-22,44,44);ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(cx-16,cy);ctx.lineTo(cx+16,cy);ctx.moveTo(cx,cy-16);ctx.lineTo(cx,cy+16);ctx.stroke();
    ctx.fillStyle='#fff';ctx.font=`600 ${Math.max(17,h*.028)}px Segoe UI`;ctx.fillText(String(i+1),cx+(px?32:-32),cy+8);
  });
  ctx.fillStyle='#aeb2c5';ctx.font=`${Math.max(14,h*.021)}px Segoe UI`;ctx.fillText('Dark room · steady phone · no flash · keep the phone outside the projector beam',w/2,h*.92);
}
window.addEventListener('resize',draw);window.lumenPicture?.onPattern(draw);draw();
