'use strict';
window.volumeOverlay.onVolume(state=>{
  const valid=state&&Number.isFinite(state.percent)&&state.percent>=0&&state.percent<=100;
  document.getElementById('card').classList.toggle('is-muted',valid&&state.muted);
  document.getElementById('card').classList.toggle('unavailable',!valid);
  document.getElementById('value').textContent=!valid?'Audio unavailable':state.muted?'Muted':`${state.percent}%`;
  document.getElementById('device').textContent=valid?state.name||'Windows audio':'Check the Windows sound output';
  document.getElementById('fill').style.width=valid&&!state.muted?`${state.percent}%`:'0%';
  const track=document.getElementById('track');track.hidden=!valid;
  if(valid){track.setAttribute('aria-valuenow',String(state.percent));track.setAttribute('aria-valuetext',state.muted?`Muted; level ${state.percent}%`:`${state.percent}%`);}else{track.removeAttribute('aria-valuenow');track.removeAttribute('aria-valuetext');}
});
