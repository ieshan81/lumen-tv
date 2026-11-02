'use strict';
// Live, read-mostly acceptance check for Movy's recurring Opera-GX interruption.
// It verifies the document-start API locks, then observes the real site for dialogs,
// visible ad overlays, off-origin navigation and new page targets.
const { Cdp } = require('../src/browser');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const [version, targets] = await Promise.all([
    fetch('http://127.0.0.1:9333/json/version').then(response => response.json()),
    fetch('http://127.0.0.1:9333/json/list').then(response => response.json())
  ]);
  const target = targets.find(item => item.type === 'page' && /(^|\.)movy\.sx\//i.test(item.url));
  if (!target) throw new Error('Movy is not the active Lumen page.');
  const page = new Cdp(target.webSocketDebuggerUrl);
  const browser = new Cdp(version.webSocketDebuggerUrl);
  await Promise.all([page.connect(), browser.connect()]);
  await page.send('Page.enable');
  await browser.send('Target.setDiscoverTargets', { discover: true });
  const baseline = new Set((await browser.send('Target.getTargets')).targetInfos.map(item => item.targetId));
  const observations = { nativeDialogs: 0, extraPages: [], visibleOperaOverlay: false, operaSrcdocFrames: false, offOrigin: false };
  page.on('event', event => {
    if (event.method === 'Page.javascriptDialogOpening') observations.nativeDialogs++;
    if (event.method === 'Page.frameNavigated' && !event.params.frame.parentId) {
      try { if (!/(^|\.)movy\.sx$/i.test(new URL(event.params.frame.url).hostname)) observations.offOrigin = true; } catch { /* incomplete navigation */ }
    }
  });
  browser.on('event', event => {
    if (event.method !== 'Target.targetCreated') return;
    const info = event.params.targetInfo;
    if (info.type === 'page' && !baseline.has(info.targetId) && info.targetId !== target.id) observations.extraPages.push(info.url || 'about:blank');
  });

  const guard = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const original={alert:window.alert,confirm:window.confirm,prompt:window.prompt,open:window.open};
      const hostile=()=>true;let redefineBlocked=false;
      try{window.alert=hostile;window.confirm=hostile;window.prompt=hostile;window.open=hostile;}catch(e){}
      try{Object.defineProperty(window,'alert',{value:hostile});}catch(e){redefineBlocked=true;}
      const started=performance.now(),answer=window.alert('Please install Opera GX to unlock the content.');
      const probe=document.createElement('iframe');
      probe.srcdoc='<p>Please install <strong>Opera GX</strong> to unlock the content.</p><script>top.postMessage({$G$:1},"*")<\\/script>';
      document.body.appendChild(probe);
      const probeBlocked=probe.__lumenBlockedFrame===1&&getComputedStyle(probe).display==='none'&&!/opera gx/i.test(probe.getAttribute('srcdoc')||'');
      probe.remove();
      return{marker:window.__lumenDialogBlocker===1&&window.__lumenPopupCloser===1,redefineBlocked,
        locked:window.alert===original.alert&&window.confirm===original.confirm&&window.prompt===original.prompt&&window.open===original.open,
        returned:answer===undefined,probeBlocked,removedFrames:window.__lumenRemovedAdFrames||0,elapsedMs:performance.now()-started,url:location.href};
    })()`,
    returnByValue: true
  });
  const guardState = guard.result?.value;
  for (let i = 0; i < 280; i++) {
    const visible = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const pattern=/install\\s+opera\\s+gx|unlock\\s+the\\s+content/i;
        const visible=Array.from(document.querySelectorAll('body *')).some(node=>{
          const style=getComputedStyle(node),rect=node.getBoundingClientRect();
          return pattern.test(node.innerText||'')&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>20&&rect.height>10;
        });
        const srcdoc=Array.from(document.querySelectorAll('iframe[srcdoc]')).some(frame=>pattern.test(frame.getAttribute('srcdoc')||''));
        return{visible,srcdoc};
      })()`,
      returnByValue: true
    }).catch(() => ({ result: { value: {visible:false,srcdoc:false} } }));
    observations.visibleOperaOverlay ||= visible.result?.value?.visible === true;
    observations.operaSrcdocFrames ||= visible.result?.value?.srcdoc === true;
    await wait(250);
  }
  const remaining = await browser.send('Target.getTargets');
  const unexpectedRemaining = remaining.targetInfos.filter(info => info.type === 'page' && info.targetId !== target.id && !info.url.startsWith('edge://'));
  const result = { guard: guardState, observations, unexpectedRemaining: unexpectedRemaining.map(info => info.url) };
  console.log(JSON.stringify(result, null, 2));
  page.close(); browser.close();
  if (!guardState?.marker || !guardState?.locked || !guardState?.redefineBlocked || !guardState?.returned || !guardState?.probeBlocked || observations.visibleOperaOverlay || observations.operaSrcdocFrames || observations.offOrigin || unexpectedRemaining.length) process.exitCode = 1;
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
