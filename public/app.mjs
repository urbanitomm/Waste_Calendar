import { DATA, STREETS, LBL, events, split, fmtD, isoD, addDays, TIMES, buildICS } from './shared.mjs';
const ZCOL={1:'#2f8f4e',2:'#2563a8',3:'#e0b100',4:'#e46aa0'};
const ZNAME={1:'Verde',2:'Blu',3:'Gialla',4:'Rosa'};
const $=id=>document.getElementById(id);
const KEY='rifiuti-trissino';
let st={zone:null,time:'20:00',xtra:false};
try{Object.assign(st,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){}
if(!TIMES.includes(st.time)) st.time='20:00';
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}};
const todayISO=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

$('t').innerHTML=TIMES.map(t=>`<option>${t}</option>`).join('');

function renderZones(){
  $('zones').innerHTML=[1,2,3,4].map(z=>`<button aria-pressed="${st.zone===z}" data-z="${z}"><span class="dot" style="background:${ZCOL[z]}"></span>Zona ${z}<small>${ZNAME[z]}</small></button>`).join('');
  $('zones').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.zone=+b.dataset.z;changed()});
}
const tagHTML=it=>it.map(c=>`<span class="tag ${c}" style="background:var(--${c})">${LBL[c]}</span>`).join('');
function renderList(){
  const today=todayISO(), nc=$('nextCard');
  if(!st.zone){nc.innerHTML='<h2>Prossimo avviso</h2><p class="note" style="margin:0">Scegli la tua zona per vedere cosa esporre.</p>';$('list').innerHTML='';return}
  const ev=events(st.zone,st.xtra,today);
  if(!ev.length){nc.innerHTML='<h2>Prossimo avviso</h2><p class="note" style="margin:0">Il calendario 2026 è finito: serve quello nuovo.</p>';$('list').innerHTML='';return}
  const n=ev[0], w=split(n.items);
  const when=n.date===today?'Oggi, '+fmtD(n.date):n.date===addDays(today,1)?'Stasera, per domani '+fmtD(n.date):'La sera di '+fmtD(addDays(n.date,-1))+', per '+fmtD(n.date);
  nc.innerHTML=`<h2>Prossimo avviso</h2><div class="next"><span class="when">${when}</span><span class="what">${w.bins.length?'Fuori: '+w.bins.join(' + '):w.info.join(', ')}</span>${w.bins.length&&w.info.length?'<span class="when">'+w.info.join(', ')+'</span>':''}</div>`;
  $('list').innerHTML=ev.slice(0,12).map(e=>`<li><span class="d">${fmtD(e.date)}</span><span class="tags">${tagHTML(e.items)}</span></li>`).join('');
}
function render(){
  renderZones();renderList();$('t').value=st.time;$('xtra').checked=st.xtra;
  for(const id of ['dl','pon']){$(id).disabled=!st.zone;$(id).style.opacity=st.zone?1:.5}
}
function changed(){save();render();$('msg').textContent='';syncPush()}
$('t').onchange=e=>{st.time=e.target.value;changed()};
$('xtra').onchange=e=>{st.xtra=e.target.checked;changed()};

// ricerca via
const ALL=[];for(const z in STREETS)for(const s of STREETS[z])ALL.push({s,z:+z});
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'.()]/g,' ').replace(/\s+/g,' ').trim();
const GENERIC=['via','viale','piazza','contra','vicolo','localita','salita','stradella','del','della','dei','delle','di'];
$('q').oninput=e=>{
  const q=norm(e.target.value);
  if(q.length<2){$('res').innerHTML='';return}
  let words=q.split(' ').filter(w=>!GENERIC.includes(w)); if(!words.length) words=q.split(' ');
  const hits=ALL.filter(x=>{const n=norm(x.s);return words.every(w=>n.includes(w))}).slice(0,8);
  $('res').innerHTML=hits.length?hits.map(h=>`<div data-z="${h.z}"><span>${h.s}</span><span>Zona ${h.z} · ${ZNAME[h.z]}</span></div>`).join(''):'<p class="note">Nessuna via trovata. Prova con un\'altra parola.</p>';
  $('res').querySelectorAll('div').forEach(d=>d.onclick=()=>{st.zone=+d.dataset.z;$('q').value='';$('res').innerHTML='';changed()});
};

// calendario
$('dl').onclick=async()=>{
  if(!st.zone) return;
  const url=`/api/ics?zone=${st.zone}&time=${encodeURIComponent(st.time)}&xtra=${st.xtra?1:0}`;
  if(location.protocol.startsWith('http')){
    try{const r=await fetch(url,{method:'HEAD'}); if(r.ok){location.href=url;return}}catch(e){}
  }
  const {text,n}=buildICS(st.zone,st.time,st.xtra,todayISO());
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/calendar'}));
  a.download=`rifiuti-trissino-zona${st.zone}.ics`;document.body.appendChild(a);a.click();a.remove();
  $('msg').textContent=`✓ File con ${n} avvisi scaricato: aprilo per aggiungerli al calendario.`;
};

// notifiche push
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const pushOK='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
let reg=null, sub=null;
const b64=s=>{const p='='.repeat((4-s.length%4)%4);const r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))};
const api=(p,body)=>fetch('/api/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('errore '+r.status));return j});
function pushUI(){
  const on=!!sub;
  $('pstatus').classList.toggle('on',on);
  $('ptext').textContent=on?`Notifiche attive · zona ${st.zone}, alle ${st.time}`:'Notifiche non attive';
  $('pon').classList.toggle('hidden',on);$('ptest').classList.toggle('hidden',!on);$('poff').classList.toggle('hidden',!on);
}
function warn(t){$('pwarn').innerHTML=t;$('pwarn').classList.toggle('hidden',!t)}
async function initPush(){
  if(!location.protocol.startsWith('http')){warn('Le notifiche funzionano quando la pagina è online (su Netlify), non aprendo il file dal telefono.');$('pon').disabled=true;return}
  if(isIOS&&!standalone){warn('<b>Su iPhone</b>: tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>, poi apri «Rifiuti» dalla schermata Home e attiva le notifiche da lì. Serve iOS 16.4 o successivo.');$('pon').disabled=true;$('pon').style.opacity=.5;return}
  if(!pushOK){warn('Questo browser non supporta le notifiche. Prova con Chrome, oppure usa il calendario qui sotto.');$('pon').disabled=true;return}
  try{reg=await navigator.serviceWorker.register('sw.js');sub=await reg.pushManager.getSubscription()}catch(e){}
  if(Notification.permission==='denied') warn('Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser.');
  pushUI(); if(sub) syncPush();
}
let syncT;
function syncPush(){
  if(!sub||!st.zone) {pushUI();return}
  clearTimeout(syncT);
  syncT=setTimeout(async()=>{try{await api('subscribe',{subscription:sub.toJSON(),zone:st.zone,time:st.time,xtra:st.xtra});$('pmsg').textContent='';}catch(e){$('pmsg').textContent='Aggiornamento non riuscito: '+e.message}pushUI()},400);
}
$('pon').onclick=async()=>{
  if(!st.zone) return;
  $('pmsg').textContent='Attivazione…';
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){$('pmsg').textContent='Permesso negato: senza il permesso non posso mandarti notifiche.';return}
    reg=reg||await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
    const {publicKey}=await fetch('/api/key').then(r=>{if(!r.ok)throw new Error('servizio non raggiungibile');return r.json()});
    sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(publicKey)});
    await api('subscribe',{subscription:sub.toJSON(),zone:st.zone,time:st.time,xtra:st.xtra});
    pushUI(); $('pmsg').textContent='✓ Fatto! Ti arriva subito una notifica di prova.';
    api('test',{subscription:sub.toJSON()}).catch(e=>$('pmsg').textContent='Attivate, ma la prova non è arrivata: '+e.message);
  }catch(e){$('pmsg').textContent='Non riuscito: '+e.message}
};
$('ptest').onclick=async()=>{$('pmsg').textContent='Invio…';try{await api('test',{subscription:sub.toJSON()});$('pmsg').textContent='✓ Inviata.'}catch(e){$('pmsg').textContent='Non riuscito: '+e.message}};
$('poff').onclick=async()=>{try{await api('unsubscribe',{subscription:sub.toJSON()})}catch(e){} try{await sub.unsubscribe()}catch(e){} sub=null;pushUI();$('pmsg').textContent='Notifiche disattivate.'};

render(); initPush();
