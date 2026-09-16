/* ============================================================ CONFIG (fetched from server — single source of truth) ============================================================ */
let PLAYERS = [], BASE_PRICE = {}, CAT_LABEL = {}, FORMATIONS = [], BUDGET = 100000000;

function nextIncrement(price){
  if(price<1000000) return 100000;
  if(price<3000000) return 250000;
  if(price<6000000) return 500000;
  if(price<15000000) return 1000000;
  if(price<30000000) return 2000000;
  return 5000000;
}
function money(n){
  if(n===null||n===undefined) return "—";
  if(n>=1000000) return "£"+(n/1000000).toFixed(n%1000000===0?0:2)+"M";
  if(n>=1000) return "£"+(n/1000).toFixed(0)+"K";
  return "£"+n;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
// Auction order, most senior groups first, highest rated within each group —
// must match lib/gameData.js on the server exactly.
const AUCTION_POS_RANK = {
  GK:1,
  LB:2, RB:2,
  CB:3,
  CDM:4, CM:4,
  CAM:5,
  LW:6, LM:6, RW:6, RM:6,
  ST:7,
};
function buildOrder(){
  return PLAYERS.map(p=>p.id).sort((a,b)=>{
    const pa=PLAYERS[a], pb=PLAYERS[b];
    const ra = AUCTION_POS_RANK[pa.pos] || 99, rb = AUCTION_POS_RANK[pb.pos] || 99;
    if(ra!==rb) return ra-rb;
    return pb.o - pa.o;
  });
}

/* ============================================================ CLIENT IDENTITY ============================================================ */
function getClientId(){
  let id = localStorage.getItem("fc27_client_id");
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : ("c"+Date.now()+Math.random().toString(36).slice(2)));
    localStorage.setItem("fc27_client_id", id);
  }
  return id;
}
const CLIENT_ID = getClientId();

/* ============================================================ APP SHELL ============================================================ */
let App = { mode:null, ready:false };

function render(){
  // Preserve whatever the person is mid-typing (or has focused) across a
  // re-render — a full innerHTML replacement otherwise wipes it, which is
  // exactly what broke the "manager name" box: the live ticker below
  // re-renders every 300ms, destroying the input on every keystroke.
  const activeEl = document.activeElement;
  const activeId = activeEl && activeEl.id;
  const isTextish = activeEl && (activeEl.tagName==="INPUT" || activeEl.tagName==="SELECT");
  const activeVal = isTextish ? activeEl.value : null;
  const selStart = isTextish && typeof activeEl.selectionStart==="number" ? activeEl.selectionStart : null;
  const selEnd = isTextish && typeof activeEl.selectionEnd==="number" ? activeEl.selectionEnd : null;

  let body;
  if(!App.ready) body = `<div class="hero"><p class="tag">Loading…</p></div>`;
  else if(App.mode===null) body = renderModeSelect();
  else if(App.mode==="offline") body = renderOfflineBody();
  else body = renderLiveShell();

  document.getElementById("app").innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="ball">⚽</span>
        <div><h1 class="display">FC27 Auction Night</h1><small>Build it at auction. Settle it on the pitch.</small></div>
      </div>
      <div class="nav">${navButtons()}</div>
    </div>
    ${body}
    <div class="footer-note">Ratings based on published EA SPORTS FC™ 27 data at launch &middot; not affiliated with EA. Player ratings and squads may change with in-season updates.</div>
  `;

  if(activeId){
    const el = document.getElementById(activeId);
    if(el && (el.tagName==="INPUT" || el.tagName==="SELECT")){
      el.value = activeVal;
      el.focus();
      if(el.setSelectionRange && selStart!==null){
        try{ el.setSelectionRange(selStart, selEnd); }catch(e){}
      }
    }
  }
}
function navButtons(){
  if(!App.ready || App.mode===null) return "";
  let btns = `<button class="pillbtn" onclick="backToMenu()">← Menu</button>`;
  if(App.mode==="offline"){
    btns = `<button class="pillbtn" onclick="goHOF()">🏆 Hall of Fame</button><button class="pillbtn" onclick="resetGame()">↺ Restart</button>` + btns;
  } else if(App.mode==="live" && L.state){
    btns = `<button class="pillbtn" onclick="leaveLiveGame()">Leave room</button>` + btns;
  }
  return btns;
}
function backToMenu(){
  if(App.mode==="live"){ leaveLiveGame(true); }
  App.mode=null; render();
}
function renderModeSelect(){
  return `
  <div class="hero">
    <div class="kicker">Build your dream team at auction</div>
    <h2 class="display">FC27<br>Auction Night</h2>
    <p class="tag">Bid for real EA SPORTS FC™ 27 rated players with a ${money(BUDGET)} budget each. Then settle it on the pitch in EA FC 27.</p>
  </div>
  <div class="grid2">
    <div class="card">
      <h3 class="display">🌐 Live — everyone on their own device</h3>
      <p style="font-size:14px; color:var(--text-dim);">One person creates a room and shares a short code. Everyone else opens this site, joins with the code, and bids from their own phone. Budgets and squads are kept private by the server itself until reveal.</p>
      <button class="btn" onclick="chooseLive()">Play live</button>
    </div>
    <div class="card">
      <h3 class="display">📺 Pass-and-play — one shared screen</h3>
      <p style="font-size:14px; color:var(--text-dim);">Everyone's around one device. Bid out loud in turn, then pass the device around privately to build your XI.</p>
      <button class="btn secondary" onclick="chooseOffline()">Play pass-and-play</button>
    </div>
  </div>
  <div class="center"><button class="pillbtn" onclick="hofFromMenu()">🏆 Live Hall of Fame</button></div>
  `;
}
function chooseOffline(){ App.mode="offline"; resetGame(); }
function chooseLive(){ App.mode="live"; render(); }
function hofFromMenu(){ App.mode="live"; render(); openHofLive(); }

/* ============================================================ LIVE (SOCKET.IO) ============================================================ */
const socket = io();
function freshLiveState(){
  return { code:null, state:null, homeWarn:"", recordDraft:{}, championId:null, recordView:false, hofView:false, hofData:null, _tickId:null };
}
let L = freshLiveState();

socket.on("state", (st)=>{ L.state = st; render(); });
socket.on("connect", ()=>{
  const savedCode = localStorage.getItem("fc27_room_code");
  if(savedCode && !L.state){
    socket.emit("joinRoom", {code:savedCode, clientId:CLIENT_ID}, (res)=>{
      if(res && res.ok){ L.code = res.code; startLiveTicker(); render(); }
    });
  }
});

function startLiveTicker(){
  if(L._tickId) return;
  // Patch just the countdown numbers in place on every tick instead of a
  // full re-render. A full re-render every 300ms was destroying and
  // recreating every button on screen — including the bid button — which
  // is why a tap could land on an element that got swapped out mid-touch
  // and silently do nothing. Only a real state change (a bid, a sale, a
  // lock) should rebuild the DOM now; that already happens via the
  // "state" socket event below.
  L._tickId = setInterval(tickLiveDisplay, 300);
}
function tickLiveDisplay(){
  if(!L.state) return;
  if(L.state.phase==="auction") updateAuctionTimerDom();
  else if(L.state.phase==="squad") updateSquadTimerDom();
}
function updateAuctionTimerDom(){
  const st = L.state;
  const order = st.order;
  if(!order || st.cur>=order.length) return;
  const secs = Math.max(0, Math.ceil(((st.lotEndsAt||0) - Date.now())/1000));
  let call=""; if(secs<=5 && secs>2) call="GOING ONCE"; else if(secs<=2 && secs>0) call="GOING TWICE";
  const ring = document.getElementById("liveTimerRing");
  if(ring){ ring.textContent = secs; ring.classList.toggle("hot", secs<=4); }
  const callEl = document.getElementById("liveGoingCall");
  if(callEl) callEl.textContent = call;
}
function updateSquadTimerDom(){
  const st = L.state;
  const meEntry = Object.entries(st.managers||{}).find(([id,m])=>m.isMe);
  if(!meEntry || meEntry[1].locked) return;
  const me = meEntry[1];
  const remaining = Math.max(0, Math.ceil(((me.squadDeadline||Date.now())-Date.now())/1000));
  const el = document.getElementById("liveSquadTimer");
  if(el) el.textContent = remaining+"s";
  const bar = document.getElementById("liveSquadProgress");
  if(bar) bar.style.width = ((1-remaining/120)*100)+"%";
}
function stopLiveTicker(){ if(L._tickId){ clearInterval(L._tickId); L._tickId=null; } }

function createLiveGame(){
  socket.emit("createRoom", {clientId:CLIENT_ID}, (res)=>{
    if(res && res.error){ L.homeWarn = res.error; render(); return; }
    L.code = res.code; localStorage.setItem("fc27_room_code", res.code);
    startLiveTicker(); render();
  });
}
function joinLiveGame(codeRaw){
  const code = (codeRaw||"").trim().toUpperCase();
  if(!code){ L.homeWarn="Enter a room code."; render(); return; }
  socket.emit("joinRoom", {code, clientId:CLIENT_ID}, (res)=>{
    if(res && res.error){ L.homeWarn = res.error; render(); return; }
    L.code = res.code; localStorage.setItem("fc27_room_code", res.code);
    startLiveTicker(); render();
  });
}
function leaveLiveGame(silent){
  stopLiveTicker();
  localStorage.removeItem("fc27_room_code");
  L = freshLiveState();
  if(!silent) render();
}
function joinAsManagerLive(name){
  name = (name||"").trim();
  if(!name) return;
  socket.emit("joinAsManager", {name}, (res)=>{
    if(res && res.error){ L.homeWarn = res.error; render(); }
  });
}
function startLiveAuction(){
  socket.emit("startAuction", {}, (res)=>{ if(res && res.error){ L.homeWarn = res.error; render(); } });
}
function placeBidLive(managerId){
  socket.emit("placeBid", {managerId}, (res)=>{ /* ignore soft errors like "already leading" */ });
}
function forceSellLive(){ socket.emit("forceSell", {}); }
function forceSkipLive(){ socket.emit("forceSkip", {}); }
function pickFormationLive(name){ socket.emit("pickFormation", {formation:name}); }
function assignSlotLive(cat, idx, playerId){ socket.emit("assignSlot", {cat, idx, playerId}); }
function clearSlotLive(cat, idx){ socket.emit("clearSlot", {cat, idx}); }
function autofillLive(){ socket.emit("autofill", {}); }
function lockSquadLive(){ socket.emit("lockSquad", {}); }

function computeRecordsLive(){
  const soldMap = (L.state && L.state.soldMap) || {};
  let mostExp=null, bargain=null, bargainVal=-1, totalSpent=0, soldCount=0, warPlayer=null;
  Object.entries(soldMap).forEach(([pidStr,s])=>{
    if(!s.soldTo) return;
    soldCount++; totalSpent+=s.price;
    const p = PLAYERS[parseInt(pidStr,10)];
    const withPrice = Object.assign({}, p, {price:s.price, bids:s.bids, soldTo:s.soldTo});
    if(!mostExp || s.price>mostExp.price) mostExp=withPrice;
    const val = p.o/(s.price/1000000);
    if(val>bargainVal){ bargainVal=val; bargain=withPrice; }
    if(!warPlayer || s.bids>warPlayer.bids) warPlayer=withPrice;
  });
  let bestSquad={name:"",spent:0};
  Object.entries((L.state&&L.state.managers)||{}).forEach(([id,m])=>{ if((m.spent||0)>bestSquad.spent) bestSquad={id,name:m.name,spent:m.spent||0}; });
  return {mostExp,bargain,bestSquad,totalSpent,soldCount,warPlayer};
}

function openRecordNightLive(){
  L.recordDraft={}; Object.keys(L.state.managers).forEach(id=>{ L.recordDraft[id]={wins:0,draws:0,losses:0}; });
  L.championId = Object.keys(L.state.managers)[0];
  L.recordView=true; render();
}
function updateRecDraft(id,field,val){ L.recordDraft[id][field]=parseInt(val)||0; }
function setChampion(id){ L.championId=id; }
function submitNightLive(){
  socket.emit("submitNight", {recordDraft:L.recordDraft, championId:L.championId}, (res)=>{
    if(res && res.error){ L.homeWarn = res.error; render(); return; }
    L.recordView=false;
    L.hofData = res.hof; L.hofView = true; render();
  });
}
function openHofLive(){
  socket.emit("getHof", {}, (res)=>{ L.hofData = (res&&res.hof)||{managers:{},log:[]}; L.hofView=true; render(); });
}
function closeHofLive(){ L.hofView=false; render(); }

/* ---------- live render ---------- */
function renderLiveShell(){
  if(L.hofView) return renderHofPage();
  if(!L.code || !L.state) return renderLiveHome();
  if(L.state.phase==="reveal" && L.recordView) return renderRecordNightLive();
  switch(L.state.phase){
    case "lobby": return renderLiveLobby();
    case "auction": return renderLiveAuction();
    case "squad": return renderLiveSquad();
    case "reveal": return renderLiveReveal();
    default: return `<div class="hero"><p>Loading…</p></div>`;
  }
}
function renderLiveHome(){
  return `
  <div class="hero">
    <div class="kicker">Live multiplayer</div>
    <h2 class="display">Start or join<br>a live room</h2>
    <p class="tag">Everyone opens this same site from their own device. One person creates the room and shares the code.</p>
  </div>
  <div class="grid2">
    <div class="card">
      <h3 class="display">Create a room</h3>
      <p class="tiny">You'll be the host — you start the auction and control sale/pass.</p>
      <button class="btn" onclick="createLiveGame()">Create room</button>
    </div>
    <div class="card">
      <h3 class="display">Join a room</h3>
      <label>Room code</label>
      <input type="text" id="joinCodeBox" maxlength="6" placeholder="e.g. K3F9Q" style="text-transform:uppercase;">
      <button class="btn secondary" style="margin-top:10px;" onclick="joinLiveGame(document.getElementById('joinCodeBox').value)">Join room</button>
    </div>
  </div>
  ${L.homeWarn?`<div class="warn center">${escapeHtml(L.homeWarn)}</div>`:""}
  <div class="center"><button class="pillbtn" onclick="openHofLive()">🏆 View Hall of Fame</button> <button class="pillbtn" onclick="backToMenu()">← Back to menu</button></div>
  `;
}
function renderLiveLobby(){
  const st = L.state;
  const managers = Object.entries(st.managers||{});
  const iAmIn = managers.some(([id,m])=>m.isMe);
  const rows = managers.map(([id,m])=>`<div class="benchCard"><b>${escapeHtml(m.name)}</b><span class="tag">${m.isMe?"You":"Joined"}</span></div>`).join("") || `<div class="tiny">No managers yet.</div>`;
  const canStart = managers.length>=2 && st.isHost;
  return `
  <div class="hero">
    <div class="kicker">Room ${L.code}</div>
    <h2 class="display">Waiting room</h2>
    <div class="codeBox">${L.code}</div>
    <p class="tag">Share this code with everyone bidding tonight.</p>
  </div>
  <div class="card">
    <h3 class="display">Managers (${managers.length})</h3>
    <div class="bench">${rows}</div>
    ${!iAmIn ? `
      <div style="margin-top:14px;">
        <label>Your manager name</label>
        <input type="text" id="liveNameBox" placeholder="e.g. Alex">
        <button class="btn small" style="margin-top:8px;" onclick="joinAsManagerLive(document.getElementById('liveNameBox').value)">Join as manager</button>
      </div>` : `<div class="tiny" style="margin-top:10px;">You're in ✅</div>`}
    ${L.homeWarn?`<div class="warn">${escapeHtml(L.homeWarn)}</div>`:""}
  </div>
  <div class="center">
    ${st.isHost ? `<button class="btn" ${canStart?"":"disabled"} onclick="startLiveAuction()">Start the auction →</button><div class="tiny">Need at least 2 managers to start.</div>` : `<p class="tiny">Waiting for the host to start the auction…</p>`}
  </div>`;
}
function renderMySquadSoFar(st){
  const meId = st.myManagerId;
  if(!meId) return "";
  const mine = Object.entries(st.soldMap||{})
    .filter(([pid,s])=>s.soldTo===meId)
    .map(([pid,s])=>({p:PLAYERS[parseInt(pid,10)], price:s.price}))
    .sort((a,b)=>b.p.o-a.p.o);
  const total = mine.reduce((a,x)=>a+x.price,0);
  const chips = mine.map(x=>`<div class="benchCard"><b>${escapeHtml(x.p.n)}</b><span class="tag">${x.p.pos} · ${x.p.o} OVR · ${money(x.price)}</span></div>`).join("");
  return `<div class="card">
    <h3 class="display">Your squad so far (${mine.length})</h3>
    ${mine.length ? `<div class="bench">${chips}</div><div class="tiny" style="margin-top:8px;">Total spent: ${money(total)}</div>` : `<p class="tiny">No players bought yet — get in there!</p>`}
  </div>`;
}
function renderLiveAuction(){
  const st = L.state;
  const order = st.order;
  const cur = st.cur;
  if(!order || cur>=order.length) return `<div class="hero"><p>Wrapping up…</p></div>`;
  const p = PLAYERS[order[cur]];
  const remainingMs = (st.lotEndsAt||0) - Date.now();
  const secs = Math.max(0, Math.ceil(remainingMs/1000));
  let call=""; if(secs<=5 && secs>2) call="GOING ONCE"; else if(secs<=2 && secs>0) call="GOING TWICE";
  const managers = Object.entries(st.managers||{});
  const inc = nextIncrement(st.currentPrice);
  const needed = st.currentPrice+inc;

  const cards = managers.map(([id,m])=>{
    const leading = st.currentBidder===id;
    let inner;
    if(m.isMe){
      const remaining = (m.budget||0)-(m.spent||0);
      const afford = remaining>=needed;
      inner = `<div class="tiny">Your remaining budget: <b>${money(remaining)}</b></div>
        <button class="bidBtn" ${leading||!afford?"disabled":""} onclick="placeBidLive('${id}')">Bid ${money(needed)}</button>`;
    } else {
      inner = `<div class="tiny">${leading?"Currently leading":"&nbsp;"}</div>`;
    }
    return `<div class="bidCard ${leading?"leading":""}">
      <div class="mgName">${escapeHtml(m.name)} ${leading?'<span class="leadTag">LEADING</span>':""} ${m.isMe?'<span class="tiny">(you)</span>':""}</div>
      ${inner}
    </div>`;
  }).join("");

  const rec = computeRecordsLive();
  return `
  <div class="auctionTop"><span>Lot ${cur+1} of ${order.length}</span><span>${rec.soldCount} sold · ${money(rec.totalSpent)} spent</span></div>
  <div class="progressBar"><div class="progressFill" style="width:${Math.round((cur/order.length)*100)}%"></div></div>
  <div class="lot">
    <div class="catTag">${CAT_LABEL[p.cat]} · Base ${money(p.base)}</div>
    <div class="ovrBadge"><b>${p.o}</b><span>OVR</span></div>
    <h2 class="display pname">${escapeHtml(p.n)}</h2>
    <div class="pmeta">${escapeHtml(p.c)} &middot; ${p.pos}</div>
    <div class="priceRow">
      <div class="priceBox"><div class="lbl">Current bid</div><div class="val">${money(st.currentPrice)}</div>
      <div class="bidder">${st.currentBidder? escapeHtml((st.managers[st.currentBidder]||{}).name||"—") : "No bids yet"}</div></div>
      <div class="timerWrap"><div class="timerRing ${secs<=4?"hot":""}" id="liveTimerRing">${secs}</div><div class="tiny">seconds</div></div>
    </div>
    <div class="goingCall" id="liveGoingCall">${call}</div>
  </div>
  <div class="bidGrid">${cards || '<div class="tiny">No managers joined.</div>'}</div>
  ${renderMySquadSoFar(st)}
  ${st.isHost?`<div class="flexbtns"><button class="pillbtn" onclick="forceSellLive()">Sell now</button><button class="pillbtn" onclick="forceSkipLive()">No bids — pass</button></div>`:""}
  <div class="card" style="margin-top:22px;">
    <h3 class="display">Auction records so far</h3>
    <div class="recordsBar">
      <div class="recStat"><div class="k">Most expensive</div><div class="v">${rec.mostExp?escapeHtml(rec.mostExp.n):"—"}</div><div class="sub">${rec.mostExp?money(rec.mostExp.price):""}</div></div>
      <div class="recStat"><div class="k">Biggest bargain</div><div class="v">${rec.bargain?escapeHtml(rec.bargain.n):"—"}</div><div class="sub">${rec.bargain?(rec.bargain.o+" OVR for "+money(rec.bargain.price)):""}</div></div>
      <div class="recStat"><div class="k">Priciest squad</div><div class="v">${rec.bestSquad.spent>0?escapeHtml(rec.bestSquad.name):"—"}</div><div class="sub">${rec.bestSquad.spent>0?money(rec.bestSquad.spent):""}</div></div>
      <div class="recStat"><div class="k">Biggest bidding war</div><div class="v">${rec.warPlayer?escapeHtml(rec.warPlayer.n):"—"}</div><div class="sub">${rec.warPlayer?rec.warPlayer.bids+" raises":""}</div></div>
    </div>
  </div>`;
}
function renderLiveSquad(){
  const st = L.state;
  const managers = Object.entries(st.managers||{});
  const meEntry = managers.find(([id,m])=>m.isMe);
  const statusList = managers.map(([id,m])=>`<div class="benchCard ${m.locked?'used':''}"><b>${escapeHtml(m.name)}</b><span class="tag">${m.locked?"✅ locked in":"⏳ picking…"}</span></div>`).join("");

  if(!meEntry){
    return `<div class="hero"><div class="kicker">Squad selection</div><h2 class="display">Spectating</h2><p class="tag">Managers are picking their formations now.</p></div><div class="bench">${statusList}</div>`;
  }
  const [meId, me] = meEntry;
  if(me.locked){
    return `<div class="hero"><div class="kicker">Squad locked ✅</div><h2 class="display">Nice XI, ${escapeHtml(me.name)}</h2><p class="tag">Waiting for everyone else to finish…</p></div><div class="bench">${statusList}</div>`;
  }
  const owned = (me.squad||[]).map(id=>PLAYERS[id]);
  const byCat = {GK:owned.filter(p=>p.cat==="GK"),DEF:owned.filter(p=>p.cat==="DEF"),MID:owned.filter(p=>p.cat==="MID"),FWD:owned.filter(p=>p.cat==="FWD")};
  const slots = me.slots||{};
  const remaining = Math.max(0, Math.ceil(((me.squadDeadline||Date.now())-Date.now())/1000));

  const formPicker = FORMATIONS.map(f=>`<button class="${me.formation===f.name?'active':''}" onclick="pickFormationLive('${f.name}')">${f.name}</button>`).join("");
  let pitchHtml = `<div class="tiny center">Choose a formation.</div>`;
  if(me.formation){
    const f = FORMATIONS.find(x=>x.name===me.formation);
    const rows=[["FWD",f.fwd],["MID",f.mid],["DEF",f.def],["GK",1]];
    pitchHtml = `<div class="pitch">`+rows.map(([cat,n])=>{
      let s="";
      for(let i=0;i<n;i++){
        const key=cat+i; const pid=slots[key];
        if(pid!==undefined){ const pl=PLAYERS[pid]; s+=`<div class="slot filled" onclick="clearSlotLive('${cat}',${i})"><div class="sn">${escapeHtml(pl.n)}</div><div class="so">${pl.o} OVR</div></div>`; }
        else s+=`<div class="slot"><div class="placeholder">${cat}</div></div>`;
      }
      return `<div class="pitchRow">${s}</div>`;
    }).join("")+`</div>`;
  }
  function findOpen(cat){ const f=FORMATIONS.find(x=>x.name===me.formation); const need=cat==="GK"?1:f[cat.toLowerCase()]; for(let i=0;i<need;i++){ if(slots[cat+i]===undefined) return i; } return null; }
  function benchGroup(cat){
    return byCat[cat].map(p=>{
      const used = Object.values(slots).includes(p.id);
      const open = me.formation? findOpen(cat) : null;
      return `<div class="benchCard ${used?'used':''}"><b>${escapeHtml(p.n)}</b><span class="tag">${p.pos} · ${p.o} OVR · ${escapeHtml(p.c)}</span>
        ${!used && open!==null && me.formation? `<button class="pillbtn" style="margin-top:4px;" onclick="assignSlotLive('${cat}',${open},${p.id})">Place in XI</button>` : (used?'<span class="tiny">In starting XI</span>':'')}</div>`;
    }).join("") || `<div class="tiny">None bought.</div>`;
  }

  return `
  <div class="auctionTop"><span>Build your squad</span><span class="display" id="liveSquadTimer">${remaining}s</span></div>
  <div class="progressBar"><div class="progressFill" id="liveSquadProgress" style="width:${(1-remaining/120)*100}%"></div></div>
  <div class="card">
    <h3 class="display">${escapeHtml(me.name)}'s formation</h3>
    <div class="formPicker">${formPicker}</div>
    ${pitchHtml}
    <div class="flexbtns"><button class="pillbtn" onclick="autofillLive()">Autofill best XI</button><button class="btn" onclick="lockSquadLive()">Lock squad ✅</button></div>
  </div>
  <div class="grid2">
    <div class="card"><h3 class="display">Bench — Forwards / Midfielders</h3><div class="bench">${benchGroup("FWD")}${benchGroup("MID")}</div></div>
    <div class="card"><h3 class="display">Bench — Defenders / GK</h3><div class="bench">${benchGroup("DEF")}${benchGroup("GK")}</div></div>
  </div>
  <div class="card"><h3 class="display">Everyone else</h3><div class="bench">${statusList}</div></div>
  `;
}
function renderLiveReveal(){
  const st = L.state;
  const managers = Object.entries(st.managers||{});
  const cards = managers.map(([id,m])=>{
    const f = FORMATIONS.find(x=>x.name===m.formation);
    const slots = m.slots||{};
    let rows="";
    if(f){
      [["FWD",f.fwd],["MID",f.mid],["DEF",f.def],["GK",1]].forEach(([cat,n])=>{
        let row="";
        for(let i=0;i<n;i++){ const pid=slots[cat+i]; row+= pid!==undefined? `<div class="miniSlot">${escapeHtml(PLAYERS[pid].n)}</div>` : `<div class="miniSlot" style="opacity:.4;">empty</div>`; }
        rows+=`<div class="miniRow">${row}</div>`;
      });
    } else rows=`<div class="tiny">No formation locked.</div>`;
    return `<div class="miniPitch"><h4>${escapeHtml(m.name)} <span class="tiny">(${m.formation||"no formation"})</span></h4>${rows}<div class="tiny" style="margin-top:8px;">Spent ${money(m.spent||0)} of ${money(BUDGET)} on ${(m.squad||[]).length} players</div></div>`;
  }).join("");
  const rec = computeRecordsLive();
  return `
  <div class="hero"><div class="kicker">All squads locked</div><h2 class="display">Reveal!</h2><p class="tag">Now settle it on the pitch in EA FC 27.</p></div>
  <div class="revealGrid">${cards}</div>
  <div class="card" style="margin-top:22px;"><h3 class="display">Final auction records</h3>
    <div class="recordsBar">
      <div class="recStat"><div class="k">Most expensive signing</div><div class="v">${rec.mostExp?escapeHtml(rec.mostExp.n):"—"}</div><div class="sub">${rec.mostExp?money(rec.mostExp.price)+" · "+escapeHtml((st.managers[rec.mostExp.soldTo]||{}).name||""):""}</div></div>
      <div class="recStat"><div class="k">Biggest bargain</div><div class="v">${rec.bargain?escapeHtml(rec.bargain.n):"—"}</div><div class="sub">${rec.bargain?(rec.bargain.o+" OVR for just "+money(rec.bargain.price)):""}</div></div>
      <div class="recStat"><div class="k">Priciest squad</div><div class="v">${escapeHtml(rec.bestSquad.name)}</div><div class="sub">${money(rec.bestSquad.spent)}</div></div>
      <div class="recStat"><div class="k">Total spent tonight</div><div class="v">${money(rec.totalSpent)}</div><div class="sub">${rec.soldCount} sold</div></div>
    </div>
  </div>
  <div class="center" style="margin-top:20px;">
    ${st.isHost?`<button class="btn" onclick="openRecordNightLive()">Record tonight's results →</button>`:`<p class="tiny">Ask the host to log tonight's results.</p>`}
    <button class="pillbtn" onclick="openHofLive()">🏆 Hall of Fame</button>
  </div>`;
}
function renderRecordNightLive(){
  const st = L.state;
  const rows = Object.entries(st.managers).map(([id,m])=>`
    <tr><td>${escapeHtml(m.name)}</td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecDraft('${id}','wins',this.value)"></td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecDraft('${id}','draws',this.value)"></td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecDraft('${id}','losses',this.value)"></td></tr>`).join("");
  const champOptions = Object.entries(st.managers).map(([id,m])=>`<option value="${id}" ${L.championId===id?"selected":""}>${escapeHtml(m.name)}</option>`).join("");
  return `
  <div class="hero"><div class="kicker">After the final whistle</div><h2 class="display">Log tonight's results</h2></div>
  <div class="card">
    <table class="hof"><tr><th>Manager</th><th>Wins</th><th>Draws</th><th>Losses</th></tr>${rows}</table>
    <div style="margin-top:16px;"><label>Champion of the night</label><select onchange="setChampion(this.value)">${champOptions}</select></div>
    <div class="center" style="margin-top:18px;"><button class="btn" onclick="submitNightLive()">Save to Hall of Fame</button></div>
  </div>`;
}
function renderHofPage(){
  const hof = L.hofData||{managers:{},log:[]};
  const list = Object.values(hof.managers||{}).sort((a,b)=> b.titles-a.titles || b.wins-a.wins);
  const rows = list.map(r=>`<tr><td>${escapeHtml(r.displayName||"—")}</td><td>${r.titles}</td><td>${r.nights}</td><td>${r.wins}-${r.draws}-${r.losses}</td><td>${money(r.priciestBuy)}</td><td>${money(r.bestSquadSpend)}</td></tr>`).join("");
  const logHtml = (hof.log||[]).slice(0,10).map(l=>`
    <div class="recStat" style="margin-bottom:8px;">
      <div class="k">${l.date} &middot; Champion: ${escapeHtml(l.champion)}</div>
      <div class="v" style="font-size:14px;">Most expensive: ${l.mostExpensive?escapeHtml(l.mostExpensive.name)+" ("+money(l.mostExpensive.price)+")":"—"}</div>
      <div class="sub">Bargain: ${l.bargain?escapeHtml(l.bargain.name)+" "+l.bargain.ovr+" OVR for "+money(l.bargain.price):"—"} &middot; Priciest squad: ${escapeHtml(l.priciestSquad.name)} (${money(l.priciestSquad.spent)})</div>
    </div>`).join("");
  return `
  <div class="hero"><div class="kicker">Across every game night</div><h2 class="display">Hall of Fame</h2><p class="tag">Shared for everyone who plays on this server.</p></div>
  <div class="card">${list.length? `<table class="hof"><tr><th>Manager</th><th>🏆 Titles</th><th>Nights</th><th>W-D-L</th><th>Priciest buy ever</th><th>Biggest squad spend</th></tr>${rows}</table>` : `<p class="tiny">No completed game nights recorded yet.</p>`}</div>
  ${(hof.log||[]).length?`<div class="card"><h3 class="display">Recent auction records</h3>${logHtml}</div>`:""}
  <div class="center"><button class="pillbtn" onclick="closeHofLive()">← Back</button></div>`;
}

/* ============================================================ OFFLINE (PASS-AND-PLAY) ENGINE ============================================================ */
const OFFLINE_HOF_KEY = "fc27_auction_hof_v1";
let S = {
  phase:"setup", managers:[], pool:null, order:[], cur:0, currentPrice:0, currentBidder:null,
  bidsOnLot:0, timer:0, timerId:null, callText:"", soldLog:[], squadIdx:0, squadTimerId:null,
  squadTimeLeft:120, peekManager:null,
};
function offlineLoadHOF(){
  try{ const raw = localStorage.getItem(OFFLINE_HOF_KEY); return raw?JSON.parse(raw):{managers:{}, log:[]}; }
  catch(e){ return {managers:{}, log:[]}; }
}
function offlineSaveHOF(data){ try{ localStorage.setItem(OFFLINE_HOF_KEY, JSON.stringify(data)); }catch(e){} }

function renderOfflineBody(){
  if(S.phase==="setup") return renderSetup();
  if(S.phase==="auction") return renderAuction();
  if(S.phase==="squad") return renderSquadPhase();
  if(S.phase==="reveal") return renderReveal();
  if(S.phase==="recordnight") return renderRecordNight();
  if(S.phase==="hof") return renderHOF();
  return "";
}
function renderSetup(){
  if(S.managers.length===0){ S.managers=[{name:""},{name:""}]; }
  const rows = S.managers.map((m,i)=>`
    <div class="managerRow">
      <input type="text" placeholder="Manager ${i+1} name" value="${escapeHtml(m.name)}" oninput="updateManagerName(${i},this.value)">
      ${S.managers.length>2?`<button class="rmBtn" onclick="removeManager(${i})" title="Remove">✕</button>`:""}
    </div>`).join("");
  return `
  <div class="hero">
    <div class="kicker">Pass-and-play</div>
    <h2 class="display">Who's bidding<br>tonight?</h2>
    <p class="tag">Everyone starts with ${money(BUDGET)}. Players come up goalkeepers → full backs → centre backs → defensive mids → attacking mids → wingers → strikers, highest rated first in each group.</p>
  </div>
  <div class="card">
    <h3 class="display">Managers</h3>
    ${rows}
    <button class="btn secondary small" onclick="addManager()">+ Add manager</button>
    <div class="tiny" style="margin-top:10px;">2–8 managers.</div>
  </div>
  <div class="grid2">
    <div class="card">
      <h3 class="display">Base prices by position</h3>
      <table class="hof">
        <tr><th>Position</th><th>Base price</th></tr>
        <tr><td>Goalkeeper</td><td>${money(BASE_PRICE.GK)}</td></tr>
        <tr><td>Defender (CB/LB/RB)</td><td>${money(BASE_PRICE.DEF)}</td></tr>
        <tr><td>Midfielder (CM/CDM/CAM)</td><td>${money(BASE_PRICE.MID)}</td></tr>
        <tr><td>Forward (ST/LW/RW/LM/RM)</td><td>${money(BASE_PRICE.FWD)}</td></tr>
      </table>
      <div class="tiny" style="margin-top:8px;">Wide midfielders (LM/RM) are auctioned as Forwards.</div>
    </div>
    <div class="card">
      <h3 class="display">Player pool</h3>
      <p style="font-size:14px; color:var(--text-dim);">${PLAYERS.length} real FC27-rated players, from Mbappé and Haaland (91 OVR) down to solid rotation options.</p>
      <button class="pillbtn" onclick="goHOF()">🏆 View Hall of Fame</button>
    </div>
  </div>
  <div class="center" style="margin-top:10px;">
    <button class="btn" onclick="startAuction()">Start the auction →</button>
    <div id="setupWarn" class="warn"></div>
  </div>`;
}
function updateManagerName(i,v){ S.managers[i].name=v; }
function addManager(){ if(S.managers.length<8){ S.managers.push({name:""}); render(); } }
function removeManager(i){ S.managers.splice(i,1); render(); }

function startAuction(){
  const names = S.managers.map(m=>m.name.trim()).filter(Boolean);
  if(names.length<2){ document.getElementById("setupWarn").textContent="Add at least 2 managers with names."; return; }
  if(new Set(names).size!==names.length){ document.getElementById("setupWarn").textContent="Manager names must be unique."; return; }
  S.managers = names.map((n,i)=>({id:i, name:n, budget:BUDGET, spent:0, squad:[], formation:null, slots:{}, locked:false}));
  S.pool = PLAYERS.map(p=>({...p, sold:false, soldTo:null, price:0, bids:0}));
  S.order = buildOrder();
  S.cur = 0; S.soldLog = [];
  S.phase = "auction";
  render();
  startLot();
}
function currentLotPlayer(){ return S.pool[S.order[S.cur]]; }
function startLot(){
  clearInterval(S.timerId);
  const p = currentLotPlayer();
  S.currentPrice = p.base; S.currentBidder = null; S.bidsOnLot = 0; S.timer = 12; S.callText = "";
  render();
  S.timerId = setInterval(tick, 1000);
}
function tick(){
  S.timer--;
  if(S.timer===5) S.callText="GOING ONCE";
  else if(S.timer===2) S.callText="GOING TWICE";
  else if(S.timer>5) S.callText="";
  if(S.timer<=0){ clearInterval(S.timerId); finalizeLot(); return; }
  render();
}
function remainingBudget(m){ return m.budget - m.spent; }
function placeBid(managerId){
  const m = S.managers.find(x=>x.id===managerId);
  if(!m || m.id===S.currentBidder) return;
  const inc = nextIncrement(S.currentPrice);
  const newPrice = S.currentPrice + inc;
  if(remainingBudget(m) < newPrice) return;
  S.currentPrice = newPrice; S.currentBidder = managerId; S.bidsOnLot++;
  S.timer = Math.max(S.timer, 10); S.callText="";
  render();
}
function finalizeLot(){
  const p = currentLotPlayer();
  if(S.currentBidder!==null){
    const m = S.managers.find(x=>x.id===S.currentBidder);
    p.sold = true; p.soldTo = m.id; p.price = S.currentPrice; p.bids = S.bidsOnLot;
    m.spent += S.currentPrice; m.squad.push(p.id);
    S.soldLog.push({playerId:p.id, managerId:m.id, price:S.currentPrice, bids:S.bidsOnLot});
  } else {
    p.sold=false; p.price=0;
    S.soldLog.push({playerId:p.id, managerId:null, price:0, bids:0});
  }
  S.cur++;
  if(S.cur>=S.order.length){ endAuction(); return; }
  render();
  setTimeout(()=>{ if(S.phase==="auction") startLot(); }, 1600);
}
function forceSell(){ if(S.phase==="auction"){ clearInterval(S.timerId); S.timer=0; finalizeLot(); } }
function forceSkip(){ if(S.phase==="auction"){ clearInterval(S.timerId); S.currentBidder=null; S.timer=0; finalizeLot(); } }
function endAuction(){
  S.phase="squad"; S.squadIdx=0;
  S.managers.forEach(m=>{ m.formation=null; m.slots={}; m.locked=false; m._turnActive=false; });
  render();
}
function computeRecords(){
  const sold = S.pool.filter(p=>p.sold);
  let mostExp=null, bargain=null, bargainVal=-1;
  sold.forEach(p=>{
    if(!mostExp || p.price>mostExp.price) mostExp=p;
    const value = p.o / (p.price/1000000);
    if(value>bargainVal){ bargainVal=value; bargain=p; }
  });
  let bestSquad={name:"",spent:0};
  S.managers.forEach(m=>{ if(m.spent>bestSquad.spent) bestSquad={name:m.name, spent:m.spent, id:m.id}; });
  const totalSpent = sold.reduce((a,p)=>a+p.price,0);
  let warPlayer=null;
  sold.forEach(p=>{ if(!warPlayer || p.bids>warPlayer.bids) warPlayer=p; });
  return {mostExp,bargain,bestSquad,totalSpent,warPlayer,soldCount:sold.length};
}
function peekManagerBudget(id){ S.peekManager=id; render(); setTimeout(()=>{ if(S.peekManager===id){S.peekManager=null; render();} },4000); }
function closePeek(){ S.peekManager=null; render(); }

function renderSquadsSoFarOffline(){
  const cards = S.managers.map(m=>{
    const mine = m.squad.map(id=>S.pool[id]).sort((a,b)=>b.o-a.o);
    const chips = mine.map(p=>`<div class="benchCard"><b>${escapeHtml(p.n)}</b><span class="tag">${p.pos} · ${p.o} OVR</span></div>`).join("") || `<p class="tiny">No players bought yet.</p>`;
    return `<div class="card">
      <h3 class="display">${escapeHtml(m.name)}'s squad so far (${mine.length})</h3>
      <div class="bench">${chips}</div>
    </div>`;
  }).join("");
  return cards;
}
function renderAuction(){
  const rec = computeRecords();
  const total = S.order.length;
  const soldCount = S.soldLog.length;
  const pct = Math.round((soldCount/total)*100);
  const p = currentLotPlayer();

  const bidCards = S.managers.map(m=>{
    const leading = S.currentBidder===m.id;
    const inc = nextIncrement(S.currentPrice);
    const needed = S.currentPrice+inc;
    const afford = remainingBudget(m) >= needed;
    return `<div class="bidCard ${leading?"leading":""}">
      <div class="mgName">${escapeHtml(m.name)} ${leading?'<span class="leadTag">LEADING</span>':""}</div>
      <button class="peek" onclick="peekManagerBudget(${m.id})" style="font-size:11px;color:var(--text-dim);text-decoration:underline;background:none;border:none;padding:0;cursor:pointer;">check my budget</button>
      <button class="bidBtn" ${leading||!afford?"disabled":""} onclick="placeBid(${m.id})">Bid ${money(needed)}</button>
    </div>`;
  }).join("");

  return `
  <div class="auctionTop"><span>Lot ${soldCount+1} of ${total}</span><span>${rec.soldCount} sold · ${money(rec.totalSpent)} spent</span></div>
  <div class="progressBar"><div class="progressFill" style="width:${pct}%"></div></div>
  <div class="lot">
    <div class="catTag">${CAT_LABEL[p.cat]} · Base ${money(p.base)}</div>
    <div class="ovrBadge"><b>${p.o}</b><span>OVR</span></div>
    <h2 class="display pname">${escapeHtml(p.n)}</h2>
    <div class="pmeta">${escapeHtml(p.c)} &middot; ${p.pos}</div>
    <div class="priceRow">
      <div class="priceBox"><div class="lbl">Current bid</div><div class="val">${money(S.currentPrice)}</div>
      <div class="bidder">${S.currentBidder!==null? escapeHtml(S.managers.find(m=>m.id===S.currentBidder).name) : "No bids yet"}</div></div>
      <div class="timerWrap"><div class="timerRing ${S.timer<=4?"hot":""}">${S.timer}</div><div class="tiny">seconds</div></div>
    </div>
    <div class="goingCall">${S.callText}</div>
  </div>
  <div class="bidGrid">${bidCards}</div>
  ${renderSquadsSoFarOffline()}
  <div class="flexbtns">
    <button class="pillbtn" onclick="forceSell()">Sell now</button>
    <button class="pillbtn" onclick="forceSkip()">No bids — pass</button>
  </div>
  <div class="card" style="margin-top:22px;">
    <h3 class="display">Auction records so far</h3>
    <div class="recordsBar">
      <div class="recStat"><div class="k">Most expensive</div><div class="v">${rec.mostExp?escapeHtml(rec.mostExp.n):"—"}</div><div class="sub">${rec.mostExp?money(rec.mostExp.price):""}</div></div>
      <div class="recStat"><div class="k">Biggest bargain</div><div class="v">${rec.bargain?escapeHtml(rec.bargain.n):"—"}</div><div class="sub">${rec.bargain?(rec.bargain.o+" OVR for "+money(rec.bargain.price)):""}</div></div>
      <div class="recStat"><div class="k">Priciest squad</div><div class="v">${rec.bestSquad.spent>0?escapeHtml(rec.bestSquad.name):"—"}</div><div class="sub">${rec.bestSquad.spent>0?money(rec.bestSquad.spent):""}</div></div>
      <div class="recStat"><div class="k">Biggest bidding war</div><div class="v">${rec.warPlayer?escapeHtml(rec.warPlayer.n):"—"}</div><div class="sub">${rec.warPlayer?rec.warPlayer.bids+" raises":""}</div></div>
    </div>
  </div>
  ${S.peekManager!==null?renderPeekModal():""}`;
}
function renderPeekModal(){
  const m = S.managers.find(x=>x.id===S.peekManager);
  return `<div class="overlay" onclick="closePeek()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="lockIcon">🔒</div>
      <div class="tiny">Private — only ${escapeHtml(m.name)} should look!</div>
      <div class="amount">${money(remainingBudget(m))}</div>
      <div class="tiny">remaining of ${money(BUDGET)} &middot; ${m.squad.length} players owned</div>
      <button class="btn small" style="margin-top:14px;" onclick="closePeek()">Got it</button>
    </div>
  </div>`;
}
function beginSquadTimer(){
  clearInterval(S.squadTimerId);
  S.squadTimerId = setInterval(()=>{
    S.squadTimeLeft--;
    if(S.squadTimeLeft<=0){ clearInterval(S.squadTimerId); lockSquad(); return; }
    render();
  },1000);
}
function activateTurn(){
  const m = S.managers[S.squadIdx]; m._turnActive = true; S.squadTimeLeft = 120;
  render(); beginSquadTimer();
}
function pickFormation(name){ const m=S.managers[S.squadIdx]; m.formation=name; m.slots={}; render(); }
function assignSlot(cat, idx, playerId){
  const m = S.managers[S.squadIdx];
  Object.keys(m.slots).forEach(k=>{ if(m.slots[k]===playerId) delete m.slots[k]; });
  m.slots[cat+idx] = playerId; render();
}
function clearSlot(cat, idx){ const m=S.managers[S.squadIdx]; delete m.slots[cat+idx]; render(); }
function autofillXI(){
  const m = S.managers[S.squadIdx]; if(!m.formation) return;
  const f = FORMATIONS.find(x=>x.name===m.formation);
  const owned = m.squad.map(id=>S.pool[id]);
  const byCat = {GK:[],DEF:[],MID:[],FWD:[]};
  owned.forEach(p=>byCat[p.cat].push(p));
  Object.values(byCat).forEach(arr=>arr.sort((a,b)=>b.o-a.o));
  m.slots = {};
  const need = {GK:1, DEF:f.def, MID:f.mid, FWD:f.fwd};
  Object.keys(need).forEach(cat=>{ for(let i=0;i<need[cat];i++){ if(byCat[cat][i]) m.slots[cat+i]=byCat[cat][i].id; } });
  render();
}
function lockSquad(){
  clearInterval(S.squadTimerId);
  S.managers[S.squadIdx].locked = true;
  S.squadIdx++;
  if(S.squadIdx>=S.managers.length){ S.phase="reveal"; render(); return; }
  render();
}
function renderSquadPhase(){
  const m = S.managers[S.squadIdx];
  if(!m._turnActive){
    return `<div class="hero" style="padding-top:60px;">
      <div class="kicker">Squad selection</div>
      <h2 class="display">Pass the device to<br>${escapeHtml(m.name)}</h2>
      <p class="tag">You'll have 2 minutes to pick a formation and your starting XI from the players you bought. Everyone else, look away!</p>
      <button class="btn" onclick="activateTurn()">I'm ${escapeHtml(m.name)} — start my clock</button>
    </div>`;
  }
  const owned = m.squad.map(id=>S.pool[id]);
  const byCat = {GK:owned.filter(p=>p.cat==="GK"), DEF:owned.filter(p=>p.cat==="DEF"), MID:owned.filter(p=>p.cat==="MID"), FWD:owned.filter(p=>p.cat==="FWD")};
  const formPicker = FORMATIONS.map(f=>`<button class="${m.formation===f.name?'active':''}" onclick="pickFormation('${f.name}')">${f.name}</button>`).join("");

  let pitchHtml = `<div class="tiny center">Choose a formation to lay out your pitch.</div>`;
  if(m.formation){
    const f = FORMATIONS.find(x=>x.name===m.formation);
    const rows = [{cat:"FWD", n:f.fwd}, {cat:"MID", n:f.mid}, {cat:"DEF", n:f.def}, {cat:"GK", n:1}];
    pitchHtml = `<div class="pitch">` + rows.map(r=>{
      let slotsHtml="";
      for(let i=0;i<r.n;i++){
        const key=r.cat+i; const pid = m.slots[key];
        if(pid!==undefined){ const pl = S.pool[pid]; slotsHtml += `<div class="slot filled" onclick="clearSlot('${r.cat}',${i})"><div class="sn">${escapeHtml(pl.n)}</div><div class="so">${pl.o} OVR</div></div>`; }
        else slotsHtml += `<div class="slot"><div class="placeholder">${r.cat}</div></div>`;
      }
      return `<div class="pitchRow">${slotsHtml}</div>`;
    }).join("") + `</div>`;
  }
  function findOpenSlot(cat){ const f = FORMATIONS.find(x=>x.name===m.formation); const need = cat==="GK"?1:f[cat.toLowerCase()]; for(let i=0;i<need;i++){ if(m.slots[cat+i]===undefined) return i; } return null; }
  function benchGroup(cat){
    return byCat[cat].map(p=>{
      const usedSlot = Object.keys(m.slots).find(k=>m.slots[k]===p.id);
      const openSlot = m.formation ? findOpenSlot(cat) : null;
      return `<div class="benchCard ${usedSlot?'used':''}">
        <b>${escapeHtml(p.n)}</b><span class="tag">${p.pos} · ${p.o} OVR · ${escapeHtml(p.c)}</span>
        ${!usedSlot && openSlot!==null && m.formation ? `<button class="pillbtn" style="margin-top:4px;" onclick="assignSlot('${cat}',${openSlot},${p.id})">Place in XI</button>` : (usedSlot?'<span class="tiny">In starting XI</span>':'')}
      </div>`;
    }).join("") || `<div class="tiny">None bought.</div>`;
  }
  return `
  <div class="auctionTop"><span>Squad selection · ${S.squadIdx+1} of ${S.managers.length}</span><span id="squadTimerVal" class="display">${S.squadTimeLeft}s</span></div>
  <div class="progressBar"><div class="progressFill" style="width:${(1-S.squadTimeLeft/120)*100}%"></div></div>
  <div class="card">
    <h3 class="display">${escapeHtml(m.name)}'s formation</h3>
    <div class="formPicker">${formPicker}</div>
    ${pitchHtml}
    <div class="flexbtns"><button class="pillbtn" onclick="autofillXI()">Autofill best XI</button><button class="btn" onclick="lockSquad()">Lock squad ✅</button></div>
  </div>
  <div class="grid2">
    <div class="card"><h3 class="display">Your bench — Forwards / Midfielders</h3><div class="bench">${benchGroup("FWD")}${benchGroup("MID")}</div></div>
    <div class="card"><h3 class="display">Your bench — Defenders / GK</h3><div class="bench">${benchGroup("DEF")}${benchGroup("GK")}</div></div>
  </div>`;
}
function renderReveal(){
  const cards = S.managers.map(m=>{
    const f = FORMATIONS.find(x=>x.name===m.formation);
    let rows="";
    if(f){
      [["FWD",f.fwd],["MID",f.mid],["DEF",f.def],["GK",1]].forEach(([cat,n])=>{
        let row="";
        for(let i=0;i<n;i++){ const pid=m.slots[cat+i]; row += pid!==undefined ? `<div class="miniSlot">${escapeHtml(S.pool[pid].n)}</div>` : `<div class="miniSlot" style="opacity:0.4;">empty</div>`; }
        rows += `<div class="miniRow">${row}</div>`;
      });
    } else rows = `<div class="tiny">No formation locked in.</div>`;
    return `<div class="miniPitch"><h4>${escapeHtml(m.name)} <span class="tiny">(${m.formation||"no formation"})</span></h4>${rows}<div class="tiny" style="margin-top:8px;">Spent ${money(m.spent)} of ${money(BUDGET)} on ${m.squad.length} players</div></div>`;
  }).join("");
  const rec = computeRecords();
  return `
  <div class="hero"><div class="kicker">All squads locked</div><h2 class="display">Reveal!</h2><p class="tag">Here's what everyone built. Now settle it on the pitch in EA FC 27.</p></div>
  <div class="revealGrid">${cards}</div>
  <div class="card" style="margin-top:22px;"><h3 class="display">Final auction records</h3>
    <div class="recordsBar">
      <div class="recStat"><div class="k">Most expensive signing</div><div class="v">${rec.mostExp?escapeHtml(rec.mostExp.n):"—"}</div><div class="sub">${rec.mostExp?money(rec.mostExp.price)+" · bought by "+escapeHtml(S.managers.find(m=>m.id===rec.mostExp.soldTo).name):""}</div></div>
      <div class="recStat"><div class="k">Biggest bargain</div><div class="v">${rec.bargain?escapeHtml(rec.bargain.n):"—"}</div><div class="sub">${rec.bargain?(rec.bargain.o+" OVR for just "+money(rec.bargain.price)):""}</div></div>
      <div class="recStat"><div class="k">Priciest squad</div><div class="v">${escapeHtml(rec.bestSquad.name)}</div><div class="sub">${money(rec.bestSquad.spent)} total spend</div></div>
      <div class="recStat"><div class="k">Total spent tonight</div><div class="v">${money(rec.totalSpent)}</div><div class="sub">${rec.soldCount} players sold · ${S.order.length-rec.soldCount} unsold</div></div>
    </div>
  </div>
  <div class="center" style="margin-top:20px;">
    <button class="btn" onclick="goRecordNight()">Record tonight's results →</button>
    <button class="pillbtn" onclick="goHOF()">🏆 Hall of Fame</button>
  </div>`;
}
let recordDraft = {};
function goRecordNight(){
  recordDraft = {};
  S.managers.forEach(m=>{ recordDraft[m.name] = {wins:0,draws:0,losses:0}; });
  recordDraft.champion = S.managers[0].name;
  S.phase="recordnight"; render();
}
function updateRecordField(name,field,val){ recordDraft[name][field] = parseInt(val)||0; }
function updateChampion(v){ recordDraft.champion = v; }
function renderRecordNight(){
  const rows = S.managers.map(m=>`
    <tr><td>${escapeHtml(m.name)}</td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecordField('${escapeHtml(m.name)}','wins',this.value)"></td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecordField('${escapeHtml(m.name)}','draws',this.value)"></td>
    <td><input type="number" min="0" value="0" style="width:70px;" oninput="updateRecordField('${escapeHtml(m.name)}','losses',this.value)"></td></tr>`).join("");
  const champOptions = S.managers.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join("");
  return `
  <div class="hero"><div class="kicker">After the final whistle</div><h2 class="display">Log tonight's results</h2><p class="tag">Once you've played your matches in EA FC 27 with these squads, record who won what — it all feeds the Hall of Fame.</p></div>
  <div class="card">
    <table class="hof"><tr><th>Manager</th><th>Wins</th><th>Draws</th><th>Losses</th></tr>${rows}</table>
    <div style="margin-top:16px;"><label>Champion of the night</label><select onchange="updateChampion(this.value)">${champOptions}</select></div>
    <div class="center" style="margin-top:18px;"><button class="btn" onclick="submitNight()">Save to Hall of Fame</button></div>
  </div>`;
}
function submitNight(){
  const rec = computeRecords();
  const hof = offlineLoadHOF();
  S.managers.forEach(m=>{
    if(!hof.managers[m.name]) hof.managers[m.name] = {nights:0,wins:0,draws:0,losses:0,titles:0,bestSquadSpend:0,priciestBuy:0};
    const d = recordDraft[m.name] || {wins:0,draws:0,losses:0};
    const h = hof.managers[m.name];
    h.nights += 1; h.wins += d.wins; h.draws += d.draws; h.losses += d.losses;
    if(recordDraft.champion===m.name) h.titles += 1;
    if(m.spent > h.bestSquadSpend) h.bestSquadSpend = m.spent;
    const myBuys = S.pool.filter(p=>p.sold && p.soldTo===m.id);
    const myMax = myBuys.reduce((a,p)=>Math.max(a,p.price),0);
    if(myMax > h.priciestBuy) h.priciestBuy = myMax;
  });
  hof.log.unshift({
    date: new Date().toLocaleDateString(),
    mostExpensive: rec.mostExp ? {name:rec.mostExp.n, price:rec.mostExp.price} : null,
    bargain: rec.bargain ? {name:rec.bargain.n, price:rec.bargain.price, ovr:rec.bargain.o} : null,
    priciestSquad: {name:rec.bestSquad.name, spent:rec.bestSquad.spent},
    champion: recordDraft.champion,
    totalSpent: rec.totalSpent
  });
  offlineSaveHOF(hof);
  goHOF();
}
function goHOF(){ S.phase="hof"; render(); }
function renderHOF(){
  const hof = offlineLoadHOF();
  const names = Object.keys(hof.managers);
  let tableHtml;
  if(names.length===0){
    tableHtml = `<p class="tiny">No completed game nights recorded yet on this device.</p>`;
  } else {
    const rows = names.map(n=>({n, ...hof.managers[n]}))
      .sort((a,b)=> b.titles-a.titles || b.wins-a.wins)
      .map(r=>`<tr><td>${escapeHtml(r.n)}</td><td>${r.titles}</td><td>${r.nights}</td><td>${r.wins}-${r.draws}-${r.losses}</td><td>${money(r.priciestBuy)}</td><td>${money(r.bestSquadSpend)}</td></tr>`)
      .join("");
    tableHtml = `<table class="hof"><tr><th>Manager</th><th>🏆 Titles</th><th>Nights</th><th>W-D-L</th><th>Priciest buy ever</th><th>Biggest squad spend</th></tr>${rows}</table>`;
  }
  const logHtml = hof.log.length ? hof.log.slice(0,10).map(l=>`
    <div class="recStat" style="margin-bottom:8px;">
      <div class="k">${l.date} &middot; Champion: ${escapeHtml(l.champion)}</div>
      <div class="v" style="font-size:14px;">Most expensive: ${l.mostExpensive?escapeHtml(l.mostExpensive.name)+" ("+money(l.mostExpensive.price)+")":"—"}</div>
      <div class="sub">Bargain: ${l.bargain?escapeHtml(l.bargain.name)+" "+l.bargain.ovr+" OVR for "+money(l.bargain.price):"—"} &middot; Priciest squad: ${escapeHtml(l.priciestSquad.name)} (${money(l.priciestSquad.spent)})</div>
    </div>`).join("") : "";
  return `
  <div class="hero"><div class="kicker">Across every game night</div><h2 class="display">Hall of Fame</h2><p class="tag">Cumulative bragging rights for your group, stored on this device/browser.</p></div>
  <div class="card">${tableHtml}</div>
  ${hof.log.length?`<div class="card"><h3 class="display">Recent auction records</h3>${logHtml}</div>`:""}
  <div class="center" style="margin-top:10px;"><button class="btn" onclick="resetGame()">Start a new auction night</button></div>`;
}
function resetGame(){
  S = {phase:"setup", managers:[], pool:null, order:[], cur:0, currentPrice:0, currentBidder:null,
       bidsOnLot:0, timer:0, timerId:null, callText:"", soldLog:[], squadIdx:0, squadTimerId:null,
       squadTimeLeft:120, peekManager:null};
  render();
}

/* ============================================================ BOOT ============================================================ */
render();
fetch("/api/config").then(r=>r.json()).then(cfg=>{
  PLAYERS = cfg.players; BASE_PRICE = cfg.basePrice; CAT_LABEL = cfg.catLabel;
  FORMATIONS = cfg.formations; BUDGET = cfg.budget;
  App.ready = true;
  render();
}).catch(()=>{
  document.getElementById("app").innerHTML = `<div class="hero"><p class="tag warn">Couldn't load game data from the server. Refresh to try again.</p></div>`;
});
