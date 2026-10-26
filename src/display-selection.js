'use strict';
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
const generic = value => !normalize(value) || /^(generic(pnp|nonpnp)?monitor|display\d*|screen\d*|unknown)$/.test(normalize(value));
const usable = display => display && display.internal !== true && display.detected !== false && display.id >= 0 && display.bounds?.width > 100 && display.bounds?.height > 100;
function sameBounds(a,b) { return a && b && ['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=2); }
function hardwareFor(display, inventory) {
  const matches=(inventory || []).filter(item=>item.active && sameBounds(display.physicalBounds || display.bounds,item.bounds));
  return matches.length===1 ? matches[0] : null;
}
function selectProjector(displays, primaryId, settings, remembered, inventory=[]) {
  const candidates=displays.filter(usable).map(display=>({display,hardware:hardwareFor(display,inventory)}));
  const pick=(items,reason)=>items.length===1 ? {display:items[0].display,hardware:items[0].hardware,reason,status:'ready'} : items.length>1 ? {display:null,reason:'More than one screen matches. Choose your projector in More.',status:'ambiguous'} : null;
  if (remembered?.manual && remembered.hardwareId) {
    const result=pick(candidates.filter(c=>c.hardware?.hardwareId===remembered.hardwareId),'Remembered projector hardware');
    if(result)return result;
    if(!inventory.length){
      const cached=pick(candidates.filter(c=>c.display.id===remembered.displayId&&(generic(c.display.label)||normalize(c.display.label)===normalize(remembered.label))),'Remembered chosen screen ID');
      if(cached)return cached;
    }
    return {display:null,reason:'Your chosen projector is not available. Choose another screen in More.',status:'missing'};
  }
  const aliases=[settings.projector?.match,...(Array.isArray(settings.projector?.aliases)?settings.projector.aliases:[])].map(normalize).filter(Boolean);
  const named=candidates.filter(c=>aliases.some(alias=>[c.display.label,c.hardware?.name].some(name=>normalize(name).includes(alias))));
  const byName=pick(named,'Projector name / Windows monitor identity');
  if(byName)return byName;
  if(remembered?.hardwareId){
    const byHardware=pick(candidates.filter(c=>c.hardware?.hardwareId===remembered.hardwareId),'Remembered projector hardware');
    if(byHardware)return byHardware;
  }
  if(remembered && (!remembered.hardwareId || !inventory.length)){
    const byId=pick(candidates.filter(c=>c.display.id===remembered.displayId && (generic(c.display.label)||normalize(c.display.label)===normalize(remembered.label))),'Remembered screen ID (hardware identity unavailable)');
    if(byId)return byId;
  }
  if(!aliases.length){
    const fallback=pick(candidates.filter(c=>c.display.id!==primaryId),'Only external secondary screen');
    if(fallback)return fallback;
  }
  return {display:null,reason:candidates.length?'No confirmed projector match. Choose a screen in More.':'No external screen is available.',status:'missing'};
}
module.exports={selectProjector,hardwareFor,usable,normalize};
