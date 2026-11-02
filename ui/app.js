'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let S = null, rows = [], focus = { r:0, c:0 }, focusKey = '', featureIndex = 0, lastInputAt = 0, pairing = false, signature = '', featureTakeover = false, activeFeature = null;
  const fallbackHero = { title:'Settle in.', overview:'Open an app or ask Jarvis what you feel like watching.', backdrop:'', mediaType:'Lumen', year:'', rating:0 };

  function appItem(tile) {
    return { key:`app:${tile.id}`, id:tile.id, type:'app', title:tile.name, subtitle:tile.desc, accent:tile.accent, image:tile.icon, mark:tile.id==='youtube'?'▶':tile.name.slice(0,1), activate:()=>lumen.launch(tile.id) };
  }
  function contentItem(item, resume = false) {
    const progress = Number(item.progress || 0);
    return {
      key:`${resume?'history':'content'}:${item.key || item.ref}`, type:'content', title:item.series || item.title,
      subtitle:resume ? `${item.season != null ? `S${item.season} · E${item.episode} · ` : ''}${Math.round(progress*100)}% watched` : [item.year,item.rating?`${Number(item.rating).toFixed(1)}/10`:''].filter(Boolean).join('  '),
      image:item.artwork || item.backdrop || item.poster, progress, accent:resume?'#36d9ff':'#ef3340', data:item,
      activate:()=>resume ? lumen.content(item.ref || '', { position:item.position || 0, url:item.url || '', title:item.series || item.title || '' }) : lumen.content(item.ref)
    };
  }
  function buildRows() {
    const built=[];
    const apps=(S.tiles||[]).map(appItem); if(apps.length)built.push({key:'apps',label:'YOUR APPS',kind:'dock',items:apps});
    const history=(S.continueWatching||[]).map(item=>contentItem(item,true));if(history.length)built.push({key:'continue',label:'CONTINUE WATCHING',kind:'cards',items:history});
    const picks=(S.assistant?.items||[]).map(item=>contentItem(item));if(picks.length)built.push({key:'jarvis',label:'JARVIS RECOMMENDS',kind:'cards',items:picks});
    const trending=(S.catalog?.featured||[]).map(item=>contentItem(item));if(trending.length)built.push({key:'trending',label:'TRENDING NOW',kind:'cards',items:trending});
    return built;
  }
  function card(item,rowKind) {
    const button=document.createElement('button');button.className=`media-card ${item.type} ${rowKind==='dock'?'app-tile':''}`;button.dataset.key=item.key;
    if(rowKind==='dock'){const mark=document.createElement('span');mark.className='app-mark';mark.textContent=item.mark||item.title.slice(0,1);if(item.image){const icon=document.createElement('img');icon.className='app-icon';icon.src=item.image;icon.alt='';icon.decoding='async';icon.onerror=()=>icon.replaceWith(mark);button.appendChild(icon);}else button.appendChild(mark);}else if(item.image){const img=document.createElement('img');img.src=item.image;img.alt='';img.decoding='async';button.appendChild(img);}else{const mono=document.createElement('span');mono.className='mono';mono.textContent=item.mono||'L';button.appendChild(mono);}
    const shade=document.createElement('span');shade.className='shade';button.appendChild(shade);
    const copy=document.createElement('span');copy.className='card-copy';const title=document.createElement('b');title.textContent=item.title;const sub=document.createElement('small');sub.textContent=item.subtitle||'';copy.append(title,sub);button.appendChild(copy);
    if(item.progress>0){const progress=document.createElement('span');progress.className='progress';progress.innerHTML=`<i style="width:${Math.round(item.progress*100)}%"></i>`;button.appendChild(progress);}
    return button;
  }
  function render() {
    const oldKey=current()?.key||focusKey;rows=buildRows();const root=$('shelves');root.replaceChildren();
    rows.forEach((row,r)=>{const section=document.createElement('section');section.className=`shelf ${row.kind}`;section.dataset.row=row.key;const head=document.createElement('div');head.className='shelf-head';head.innerHTML=`<span>${row.label}</span><i></i>`;const track=document.createElement('div');track.className='track';row.items.forEach((item,c)=>{item.el=card(item,row.kind);item.el.addEventListener('click',()=>{focus={r,c};applyFocus(false);activate();});track.appendChild(item.el);});section.append(head,track);root.appendChild(section);row.el=section;row.track=track;row.shift=0;});
    let located=null;rows.forEach((row,r)=>row.items.forEach((item,c)=>{if(item.key===oldKey)located={r,c};}));focus=located||{r:0,c:0};focus.r=Math.min(focus.r,Math.max(0,rows.length-1));focus.c=Math.min(focus.c,Math.max(0,(rows[focus.r]?.items.length||1)-1));applyFocus(false);
  }
  function current(){return rows[focus.r]?.items[focus.c];}
  function heroFor(item){if(item?.type==='content')return item.data;const featured=S?.catalog?.featured||[];return featured[featureIndex%Math.max(1,featured.length)]||fallbackHero;}
  function setHero(data,item){data=data||fallbackHero;const next=data.backdrop||data.artwork||data.poster||'';$('backdrop').style.backgroundImage=next?`url("${next.replace(/"/g,'')}")`:'';window.lumenHearth?.setArtwork(next);const title=data.title||data.series||fallbackHero.title,titleNode=$('heroTitle'),logo=$('heroLogo'),logoUrl=data.logo||'';titleNode.textContent=title;titleNode.hidden=false;logo.hidden=true;logo.onload=null;logo.onerror=null;logo.removeAttribute('src');logo.alt=title;if(logoUrl){logo.dataset.source=logoUrl;logo.onload=()=>{if(logo.dataset.source===logoUrl){logo.hidden=false;titleNode.hidden=true;}};logo.onerror=()=>{if(logo.dataset.source===logoUrl){logo.hidden=true;titleNode.hidden=false;}};logo.src=logoUrl;if(logo.complete&&logo.naturalWidth)logo.onload();}$('heroDescription').textContent=data.overview||fallbackHero.overview;$('heroMeta').textContent=[data.year,data.rating?`${Number(data.rating).toFixed(1)}/10`:'',data.season!=null?`SEASON ${data.season} · EPISODE ${data.episode}`:''].filter(Boolean).join('   ·   ');$('heroAction').textContent=item?.type==='app'?`Open ${item.title}`:item?.progress>0?'Continue watching':'Watch now';$('heroCopy').classList.remove('swap');void $('heroCopy').offsetWidth;$('heroCopy').classList.add('swap');}
  function applyFocus(animate=true){const item=current();if(!item)return;if(animate){featureTakeover=false;activeFeature=null;document.body.classList.remove('spotlight-mode');}focusKey=item.key;rows.forEach((row,r)=>{row.el.classList.toggle('active',r===focus.r);row.items.forEach(candidate=>candidate.el.classList.toggle('focused',candidate===item));});const row=rows[focus.r],cardEl=item.el,available=innerWidth-140;let shift=row.shift;const right=cardEl.offsetLeft+cardEl.offsetWidth-shift;if(right>available)shift+=right-available;if(cardEl.offsetLeft-shift<70)shift-=70-(cardEl.offsetLeft-shift);row.shift=Math.max(0,shift);row.track.style.transform=`translateX(${-row.shift}px)`;const first=rows[0]?.el?.offsetTop||0;$('shelves').style.transform=`translateY(${Math.min(0,-(row.el.offsetTop-first))}px)`;setHero(heroFor(item),item);if(animate)lastInputAt=Date.now();}
  function move(dr,dc){if(!rows.length)return;if(dc){const c=Math.max(0,Math.min(rows[focus.r].items.length-1,focus.c+dc));if(c===focus.c)return;focus.c=c;}else{const r=Math.max(0,Math.min(rows.length-1,focus.r+dr));if(r===focus.r)return;focus.r=r;focus.c=Math.min(focus.c,rows[r].items.length-1);}applyFocus();}
  function activate(){if(featureTakeover&&activeFeature?.ref){lumen.content(activeFeature.ref);return;}current()?.activate();}
  function openPairing(){const remote=S?.remote||{};$('qr').innerHTML=remote.qr||'';$('pairUrl').textContent=remote.urls?.[0]||'';$('blocked').hidden=!remote.blocked;$('pairing').hidden=false;pairing=true;}
  function closePairing(){$('pairing').hidden=true;pairing=false;}
  function key(k){lastInputAt=Date.now();if(pairing){if(['Esc','Back','Enter','Space'].includes(k))closePairing();return;}if(k==='Left')move(0,-1);else if(k==='Right')move(0,1);else if(k==='Up')move(-1,0);else if(k==='Down')move(1,0);else if(k==='Enter'||k==='Space')activate();else if(k==='Esc'||k==='Back'||k==='Backspace'){if(S?.running)lumen.action('resume');else openPairing();}}
  lumen.onNav(key);window.addEventListener('keydown',e=>{const map={ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Enter:'Enter',' ':'Space',Escape:'Esc',Backspace:'Back'};if(map[e.key]){e.preventDefault();key(map[e.key]);}});
  lumen.onState(state=>{S=state;$('chip').classList.toggle('live',state.remote.clients>0);$('chipText').textContent=state.remote.clients>0?'REMOTE LINKED':'PAIR REMOTE';const a=state.assistant||{};$('jarvisText').textContent=a.status==='thinking'?'Thinking':a.voice?.armed?'Listening':a.voice?.listening?'Online':'Ready';$('jarvis').classList.toggle('listening',a.status==='thinking'||a.voice?.armed);$('jarvisReply').hidden=!a.message;$('jarvisReply').querySelector('p').textContent=a.message||'';const next=JSON.stringify({tiles:state.tiles,history:state.continueWatching,catalog:state.catalog?.featured,assistant:state.assistant?.items,running:state.running});if(next!==signature){signature=next;render();}if(pairing){$('qr').innerHTML=state.remote.qr||'';if(state.remote.clients>0)closePairing();}});
  lumen.onToast(text=>{const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(el.timer);el.timer=setTimeout(()=>el.classList.remove('show'),4200);});
  function tick(){const now=new Date();$('time').textContent=now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});$('date').textContent=now.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}).toUpperCase();}tick();setInterval(tick,15000);
  setInterval(()=>{if(!S||Date.now()-lastInputAt<12000||!S.catalog?.featured?.length)return;featureIndex=(featureIndex+1)%S.catalog.featured.length;activeFeature=heroFor(null);featureTakeover=true;document.body.classList.add('spotlight-mode');rows.forEach(row=>row.items.forEach(item=>item.el.classList.remove('focused')));setHero(activeFeature,null);},9000);
  window.addEventListener('resize',()=>applyFocus(false));lumen.ready();
})();
