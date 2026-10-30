'use strict';
window.createLumenCalibration=function({send,toast}){
  const $=id=>document.getElementById(id),math=window.LumenPictureMath;
  let state=null,opened=false,session='',corners=[],photo=null,source='manual',previousActive=false,until=null;
  const canvas=$('calPhoto'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  function adjustment(){return Object.fromEntries(['red','green','blue','gamma'].map(key=>[key,Number($('cal'+key).value)]));}
  function controls(value){for(const key of ['red','green','blue','gamma']){$('cal'+key).value=value[key];$('cal'+key+'Value').textContent=value[key].toFixed(2);}}
  function command(action,extra={}){return send({t:'calibration',action,sessionId:state?.sessionId,...extra});}
  function clearPhoto(){photo=null;corners=[];canvas.width=1;canvas.height=1;$('calPhotoWrap').hidden=true;$('calFile').value='';}
  function show(value){opened=value;$('calibrationDialog').hidden=!value;document.body.classList.toggle('calibrating',value);if(value)$('calClose').focus({preventScroll:true});else{clearPhoto();$('calibratePicture').focus({preventScroll:true});}}
  function render(server){
    state=server.calibration||null;
    const busy=!!state?.busy,active=!!state?.active;
    $('calibratePicture').disabled=!state||server.starting;
    $('pictureProfileNote').textContent=state?.error||(state?.profileSaved?'Saved projector picture profile is active.':'Tune the projector with a test chart, a phone photo and a reversible preview.');
    $('resetPicture').hidden=!state?.profileSaved;
    $('resetPicture').disabled=active||busy||server.mode==='off';
    if(active&&state.sessionId!==session){session=state.sessionId;source='manual';clearPhoto();controls(state.adjustment||math.IDENTITY);show(true);}
    if(previousActive&&!active){show(false);if(state?.error)toast(state.error);else if(state?.phase==='saved')toast('Projector picture profile saved.');}
    previousActive=active;
    $('calPrepare').hidden=active;
    $('calWorking').hidden=!active;
    $('calBegin').disabled=busy||server.starting;
    $('calBegin').textContent=server.starting?'Starting Lumen…':'Show the test chart';
    $('calProgress').textContent=busy?'Working…':state?.phase==='preview'?'Compare your picture':active?'Capture the test chart':'Set up your projector picture';
    $('calError').textContent=state?.error||'';$('calError').hidden=!state?.error;
    $('calCamera').disabled=busy||state?.phase==='preview';
    $('calAnalyze').disabled=busy||corners.length!==4;
    $('calPreview').disabled=busy||!state?.supported;
    $('calEstimate').disabled=busy||!state?.supported||!state?.analysis?.usable;
    $('calSave').disabled=busy||state?.phase!=='preview'||!state?.supported;
    $('calCompare').hidden=state?.phase!=='preview';
    $('calOriginal').disabled=busy;$('calAdjusted').disabled=busy;$('calChart').disabled=busy;
    $('calOriginal').setAttribute('aria-pressed',String(state?.view==='original'));
    $('calAdjusted').setAttribute('aria-pressed',String(state?.view==='adjusted'));
    $('calAnalysis').hidden=!state?.analysis;
    $('calAnalysisTitle').textContent=state?.analysis?.usable?'Photo checks passed':'Retake this photo';
    $('calAnalysisText').textContent=state?.analysis?.usable?state.analysis.note:state?.analysis?.reasons?.join(' ')||'';
    $('calEstimate').hidden=!state?.analysis?.usable;
    until=state?.previewUntil;tick();
  }
  function tick(){const seconds=until?Math.max(0,Math.ceil((until-Date.now())/1000)):0;$('calCountdown').hidden=!until;$('calCountdown').textContent=`Preview reverts in ${seconds}s unless you save.`;}
  setInterval(tick,1000);
  $('calibratePicture').addEventListener('click',()=>{show(true);controls(state?.adjustment||math.IDENTITY);});
  $('calBegin').addEventListener('click',()=>send({t:'calibration',action:'start'}));
  $('calClose').addEventListener('click',()=>{if(state?.active)command('cancel');else show(false);});
  $('calibrationDialog').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('calClose').click();}if(event.key==='Tab'){const nodes=Array.from($('calibrationDialog').querySelectorAll('button,input,a')).filter(node=>!node.disabled&&!node.closest('[hidden]'));const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  $('calCamera').addEventListener('click',()=>{$('calFile').value='';$('calFile').click();});
  $('calFile').addEventListener('change',async()=>{
    const file=$('calFile').files?.[0];if(!file)return;
    const captureSession=session;
    try{
      if(file.size>30*1024*1024||!/^image\//.test(file.type))throw new Error('Choose a photo under 30 MB.');
      const url=URL.createObjectURL(file),image=new Image();
      try{image.src=url;await image.decode();if(!opened||session!==captureSession)return;if(image.naturalWidth*image.naturalHeight>60000000)throw new Error('Use a standard-resolution photo of the test chart.');
        const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);ctx.drawImage(image,0,0,canvas.width,canvas.height);photo=ctx.getImageData(0,0,canvas.width,canvas.height);corners=[];$('calPhotoWrap').hidden=false;drawPhoto();
      }finally{URL.revokeObjectURL(url);}
    }catch(error){toast(error.message||'This photo could not be opened. Try a JPEG photo.');}
  });
  function drawPhoto(){
    if(!photo)return;ctx.putImageData(photo,0,0);
    corners.forEach((point,index)=>{ctx.beginPath();ctx.arc(point.x,point.y,Math.max(10,canvas.width*.014),0,Math.PI*2);ctx.fillStyle='#a99bff';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#151020';ctx.font=`bold ${Math.max(14,canvas.width*.021)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),point.x,point.y);});
    $('calCornerHint').textContent=corners.length===4?'All corners marked. Analyze the chart.':`Tap cross ${corners.length+1}: ${['top left','top right','bottom right','bottom left'][corners.length]}.`;
    $('calAnalyze').disabled=corners.length!==4||!!state?.busy;
  }
  canvas.addEventListener('click',event=>{if(!photo||corners.length===4)return;const box=canvas.getBoundingClientRect();corners.push({x:(event.clientX-box.left)*canvas.width/box.width,y:(event.clientY-box.top)*canvas.height/box.height});drawPhoto();});
  $('calClearCorners').addEventListener('click',()=>{corners=[];drawPhoto();});
  $('calAnalyze').addEventListener('click',()=>{try{command('analyze',{samples:math.samples(photo,corners)});}catch(error){toast(error.message);}});
  for(const key of ['red','green','blue','gamma'])$('cal'+key).addEventListener('input',()=>{source='manual';$('cal'+key+'Value').textContent=Number($('cal'+key).value).toFixed(2);});
  $('calNeutral').addEventListener('click',()=>{source='manual';controls(math.IDENTITY);});
  $('calEstimate').addEventListener('click',()=>{if(!state?.analysis?.usable)return;source='camera-estimate';controls(state.analysis.suggestion);command('preview',{source,adjustment:state.analysis.suggestion});});
  $('calPreview').addEventListener('click',()=>command('preview',{source,adjustment:adjustment()}));
  $('calOriginal').addEventListener('click',()=>command('compare',{view:'original'}));
  $('calAdjusted').addEventListener('click',()=>command('compare',{view:'adjusted'}));
  $('calChart').addEventListener('click',()=>command('chart'));
  $('calSave').addEventListener('click',()=>command('save'));
  $('resetPicture').addEventListener('click',()=>{if(confirm('Remove the saved projector picture profile and restore the original output?'))send({t:'calibration',action:'reset'});});
  return {render};
};
