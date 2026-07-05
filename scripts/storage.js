/* ================= storage ================= */
let customLevels = [];
const memoryStore = {};
async function storageGet(key){
  try{ if (window.storage && window.storage.get){ const r = await window.storage.get(key, false); return r ? r.value : null; } }
  catch(e){}
  return memoryStore[key] || null;
}
async function storageSet(key, value){
  try{ if (window.storage && window.storage.set){ await window.storage.set(key, value, false); return; } }
  catch(e){}
  memoryStore[key] = value;
}
async function loadCustomLevels(){
  const raw = await storageGet('custom-levels');
  try{ customLevels = raw ? JSON.parse(raw) : []; } catch(e){ customLevels = []; }
}
async function persistCustomLevels(){ await storageSet('custom-levels', JSON.stringify(customLevels)); }
