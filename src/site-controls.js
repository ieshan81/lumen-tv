'use strict';
const SITE_ACTIONS=Object.freeze(['nextEpisode','previousEpisode','showEpisodes','audioSubtitles','quality','skipIntro','skipRecap']);

// Serialized into the page. Reads DOM metadata only unless a whitelisted command is supplied.
function siteControls(siteId,origins,command,expectedPageKey){
  const pageKey=location.href;
  const names=['nextEpisode','previousEpisode','showEpisodes','audioSubtitles','quality','skipIntro','skipRecap'];
  const actions=Object.fromEntries(names.map(name=>[name,false]));
  if(command&&(!names.includes(command)||expectedPageKey!==pageKey))return false;
  const normalize=value=>String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[\s\u00a0]+/g,' ').trim();
  function usable(node,autoHidden=false){
    if(!node||node.disabled||node.closest('[hidden],[inert],[aria-disabled="true"],[aria-hidden="true"]'))return false;
    if(node.tagName==='A'&&node.querySelector('button:disabled,button[aria-disabled="true"]'))return false;
    const rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
    if(node.checkVisibility)return node.checkVisibility({visibilityProperty:true,opacityProperty:!autoHidden});
    return getComputedStyle(node).visibility!=='hidden';
  }
  const video=Array.from(document.querySelectorAll('video,audio')).find(node=>node.tagName==='AUDIO'||usable(node,true));
  const play=document.querySelector('#ButtonPlay');
  const movy=siteId==='movy'&&origins.includes(location.origin)&&window.top===window&&!!play&&!!video;
  let root=document;
  if(movy){root=video.parentElement;while(root.parentElement&&!root.contains(play))root=root.parentElement;}
  const definitions={
    nextEpisode:{id:'nextEpisodeBtn',pattern:/^next episode(?:\s*\([a-z]\))?$/},
    previousEpisode:{id:'prevEpisodeBtn',pattern:/^(?:previous|prev) episode(?:\s*\([a-z]\))?$/},
    showEpisodes:{pattern:/^(?:episodes|episode list|choose episode)$/},
    audioSubtitles:{pattern:/^(?:audio and subtitles|subtitles|captions|audio and captions)$/},
    quality:{pattern:/^quality(?:\s*(?:auto|\d{3,4}p|4k|8k|and speed))?$/},
    skipIntro:{pattern:/^skip intro(?:duction)?$/},
    skipRecap:{pattern:/^skip recap$/}
  };
  const targets={};const hooks={};
  const nodes=video?Array.from(root.querySelectorAll('button,a[href],[role="button"]')).slice(0,600):[];
  const episodePath=/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(location.pathname);
  for(const name of names){
    const def=definitions[name];
    if(['nextEpisode','previousEpisode'].includes(name)&&typeof window.LumenTV?.[name]==='function'){
      try{if(['browse','home'].includes(window.LumenTV.getState?.()?.page))continue;}catch{/* the hook may omit metadata */}
      const button=document.getElementById(def.id);
      if(!button||(!button.disabled&&!button.closest('[aria-disabled="true"]'))){actions[name]=true;hooks[name]=true;}
      continue;
    }
    const matches=[];
    for(const node of nodes){
      const autoHidden=movy&&node.matches('button.tabbable');
      if(!usable(node,autoHidden))continue;
      const labels=[node.getAttribute('aria-label'),node.getAttribute('title'),node.textContent].map(normalize);
      if(!(def.id&&node.id===def.id)&&!labels.some(label=>label.length<=80&&def.pattern.test(label)))continue;
      const target=node.closest('a[href]')||node;
      if(!usable(target,autoHidden))continue;
      if(movy&&['nextEpisode','previousEpisode'].includes(name)&&target.tagName==='A'){
        const url=new URL(target.href,location.href);const match=/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
        if(url.origin!==location.origin||!match||!episodePath||match[1]!==episodePath[1]||url.pathname===location.pathname)continue;
      }
      if(!matches.includes(target))matches.push(target);
    }
    // Distinct controls with the same label are ambiguous; do not pick by document order.
    if(matches.length===1){actions[name]=true;targets[name]=matches[0];}
  }
  const info={};
  if(movy&&episodePath){info.season=Number(episodePath[2]);info.episode=Number(episodePath[3]);const title=root.querySelector('h1')?.textContent?.trim();if(title)info.title=title.slice(0,160);}
  if(!command)return {pageKey,actions,info};
  if(!actions[command])return false;
  if(hooks[command]){try{window.LumenTV[command]();return true;}catch{return false;}}
  const target=targets[command];if(!target)return false;
  const menuAction=['showEpisodes','audioSubtitles','quality'].includes(command);
  const button=target.tagName==='A'?target.querySelector('button')||target:target;
  const panelFor=()=>{
    const controlled=document.getElementById(button.getAttribute('aria-controls')||'');
    if(controlled&&usable(controlled))return controlled;
    return Array.from(button.parentElement?.children||[]).find(node=>node!==button&&['absolute','fixed'].includes(getComputedStyle(node).position)&&node.querySelector('button,[role="menuitem"],a[href]')&&usable(node));
  };
  function trackMenu(panel){
    if(!panel)return;
    document.querySelectorAll('[data-lumen-site-menu]').forEach(node=>node.removeAttribute('data-lumen-site-menu'));
    panel.setAttribute('data-lumen-site-menu','true');
    window.__lumenSiteMenu={panel,trigger:button,close(){
      button.click();button.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));
      panel.removeAttribute('data-lumen-site-menu');button.focus({preventScroll:true});window.__lumenSiteMenu=null;
    }};
    const first=Array.from(panel.querySelectorAll('button,a[href],[role="menuitem"],[tabindex="0"]')).find(node=>usable(node));
    first?.focus({preventScroll:true});
  }
  if(menuAction){const panel=panelFor();if(panel){trackMenu(panel);return true;}}
  target.focus({preventScroll:true});target.click();
  if(menuAction)requestAnimationFrame(()=>{
    let panel=panelFor();
    if(!panel){button.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body}));}
    requestAnimationFrame(()=>{panel=panelFor();if(panel)trackMenu(panel);});
  });
  return true;
}
const expression=(siteId,origins,command=null,pageKey=null)=>`(${siteControls.toString()})(${JSON.stringify(siteId)},${JSON.stringify(origins)},${JSON.stringify(command)},${JSON.stringify(pageKey)})`;
module.exports={SITE_ACTIONS,siteControlsExpression:expression};
