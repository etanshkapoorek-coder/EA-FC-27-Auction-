const { PLAYERS, FORMATIONS, BUDGET, buildOrder, nextIncrement } = require("./gameData");

const LOT_SECONDS = 12;
const REBID_SECONDS = 10;
const SQUAD_SECONDS = 120;

function createRoom(code, hostClientId){
  return {
    code, hostClientId, phase:"lobby", createdAt: Date.now(),
    managers: {}, order: null, cur: 0, currentPrice: 0, currentBidder: null,
    bidsOnLot: 0, lotEndsAt: 0, soldMap: {}
  };
}
function findManagerByClient(room, clientId){
  return Object.entries(room.managers).find(([id,m])=>m.clientId===clientId) || null;
}
function joinAsManager(room, clientId, name){
  name = (name||"").toString().trim().slice(0,40);
  if(!name) return {error:"Enter a name."};
  if(findManagerByClient(room, clientId)) return {error:"You've already joined this room."};
  if(Object.keys(room.managers).length>=8) return {error:"Room is full (8 managers max)."};
  const id = "m"+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3);
  room.managers[id] = {
    name, clientId, budget: BUDGET, spent:0, squad:[], formation:null, slots:{},
    locked:false, squadDeadline:null
  };
  return {id};
}
function startAuction(room, clientId){
  if(room.hostClientId!==clientId) return {error:"Only the host can start the auction."};
  if(room.phase!=="lobby") return {error:"The auction has already started."};
  if(Object.keys(room.managers).length<2) return {error:"Need at least 2 managers to start."};
  room.order = buildOrder();
  room.cur = 0;
  const first = PLAYERS[room.order[0]];
  room.currentPrice = first.base;
  room.currentBidder = null;
  room.bidsOnLot = 0;
  room.lotEndsAt = Date.now()+LOT_SECONDS*1000;
  room.phase = "auction";
  return {};
}
function placeBid(room, clientId, managerId){
  if(room.phase!=="auction") return {error:"The auction isn't running right now."};
  const m = room.managers[managerId];
  if(!m || m.clientId!==clientId) return {error:"That's not your manager seat."};
  if(room.currentBidder===managerId) return {error:"You're already the highest bidder."};
  const inc = nextIncrement(room.currentPrice);
  const newPrice = room.currentPrice+inc;
  const remaining = m.budget-m.spent;
  if(remaining<newPrice) return {error:"Not enough budget for that bid."};
  room.currentPrice = newPrice;
  room.currentBidder = managerId;
  room.bidsOnLot += 1;
  room.lotEndsAt = Date.now()+REBID_SECONDS*1000;
  return {};
}
function finalizeLot(room, opts){
  opts = opts||{};
  if(room.phase!=="auction") return {};
  if(opts.clearBidder) room.currentBidder=null;
  const order = room.order, cur = room.cur;
  if(!order || cur>=order.length) return {};
  const playerId = order[cur];

  if(room.currentBidder && room.managers[room.currentBidder]){
    const mg = room.managers[room.currentBidder];
    room.soldMap[playerId] = {soldTo:room.currentBidder, price:room.currentPrice, bids:room.bidsOnLot};
    mg.spent += room.currentPrice;
    mg.squad.push(playerId);
  } else {
    room.soldMap[playerId] = {soldTo:null, price:0, bids:0};
  }

  room.cur = cur+1;
  if(room.cur>=order.length){
    room.phase = "squad";
    room.currentBidder = null;
    const deadline = Date.now()+SQUAD_SECONDS*1000;
    Object.values(room.managers).forEach(m=>{ m.squadDeadline = deadline; });
  } else {
    const nextP = PLAYERS[order[room.cur]];
    room.currentPrice = nextP.base;
    room.currentBidder = null;
    room.bidsOnLot = 0;
    room.lotEndsAt = Date.now()+LOT_SECONDS*1000;
  }
  return {};
}
/**
 * Move (or place, or swap, or unassign) a player on the pitch in one atomic
 * step. Any owned player can go in any slot — the manager decides where to
 * play them, not the game.
 *   toCat/toIdx null  -> unassign (send back to the bench)
 *   slot already has someone -> swap them into the player's old spot
 *                                (or the bench, if they came from the bench)
 */
function movePlayerToSlot(room, clientId, playerId, toCat, toIdx){
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const m = e[1];
  if(!m.squad.includes(playerId)) return {error:"You don't own that player."};

  let fromKey = null;
  Object.keys(m.slots).forEach(k=>{ if(m.slots[k]===playerId) fromKey = k; });

  if(toCat===null || toCat===undefined){
    if(fromKey) delete m.slots[fromKey];
    return {};
  }
  const toKey = toCat+toIdx;
  const occupant = m.slots[toKey];
  if(fromKey && fromKey!==toKey){
    if(occupant!==undefined) m.slots[fromKey] = occupant;
    else delete m.slots[fromKey];
  }
  m.slots[toKey] = playerId;
  return {};
}
function pickFormation(room, clientId, formationName){  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  if(!FORMATIONS.find(f=>f.name===formationName)) return {error:"Unknown formation."};
  e[1].formation = formationName;
  e[1].slots = {};
  return {};
}
function autofillSlots(room, clientId){
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const m = e[1];
  if(!m.formation) return {error:"Pick a formation first."};
  const f = FORMATIONS.find(x=>x.name===m.formation);
  const owned = m.squad.map(id=>PLAYERS[id]);
  const byCat = {GK:[],DEF:[],MID:[],FWD:[]};
  owned.forEach(p=>byCat[p.cat].push(p));
  Object.values(byCat).forEach(a=>a.sort((a,b)=>b.o-a.o));
  const need = {GK:1, DEF:f.def, MID:f.mid, FWD:f.fwd};
  const slots = {};
  Object.keys(need).forEach(cat=>{ for(let i=0;i<need[cat];i++){ if(byCat[cat][i]) slots[cat+i]=byCat[cat][i].id; } });
  m.slots = slots;
  return {};
}
function lockSquad(room, clientId){
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  e[1].locked = true;
  const allLocked = Object.values(room.managers).every(m=>m.locked);
  if(allLocked) room.phase = "reveal";
  return {allLocked};
}
function autoLockManager(room, managerId){
  const m = room.managers[managerId];
  if(!m || m.locked) return {allLocked:false};
  m.locked = true;
  const allLocked = Object.values(room.managers).every(x=>x.locked);
  if(allLocked) room.phase = "reveal";
  return {allLocked};
}
function computeRecords(room){
  let mostExp=null, bargain=null, bargainVal=-1, totalSpent=0, soldCount=0, warPlayer=null;
  Object.entries(room.soldMap||{}).forEach(([pidStr,s])=>{
    if(!s.soldTo) return;
    soldCount++; totalSpent+=s.price;
    const p = PLAYERS[parseInt(pidStr,10)];
    const withPrice = Object.assign({}, p, {price:s.price, bids:s.bids, soldTo:s.soldTo});
    if(!mostExp || s.price>mostExp.price) mostExp=withPrice;
    const val = p.o/(s.price/1000000);
    if(val>bargainVal){ bargainVal=val; bargain=withPrice; }
    if(!warPlayer || s.bids>warPlayer.bids) warPlayer=withPrice;
  });
  let bestSquad = {name:"", spent:0, id:null};
  Object.entries(room.managers||{}).forEach(([id,m])=>{ if((m.spent||0)>bestSquad.spent) bestSquad={id, name:m.name, spent:m.spent||0}; });
  return {mostExp, bargain, bestSquad, totalSpent, soldCount, warPlayer};
}

/** Per-viewer redacted snapshot: hides other managers' budgets always, and
 * hides squads/formations until the reveal phase. This is enforced on the
 * server, not just the UI, so it's genuinely private. */
function redactRoomFor(room, clientId){
  if(!room) return null;
  const meEntry = findManagerByClient(room, clientId);
  const meId = meEntry ? meEntry[0] : null;
  const revealAll = room.phase==="reveal";
  const managers = {};
  Object.entries(room.managers||{}).forEach(([id,m])=>{
    const isMe = id===meId;
    managers[id] = {
      name: m.name,
      isMe,
      locked: m.locked,
      budget: isMe ? m.budget : null,
      spent: (isMe || revealAll) ? m.spent : null,
      squad: (isMe || revealAll) ? m.squad : null,
      formation: (isMe || revealAll) ? m.formation : null,
      slots: (isMe || revealAll) ? m.slots : null,
      squadDeadline: isMe ? m.squadDeadline : null,
    };
  });
  return {
    code: room.code, phase: room.phase, isHost: room.hostClientId===clientId,
    order: room.order, cur: room.cur, currentPrice: room.currentPrice,
    currentBidder: room.currentBidder, bidsOnLot: room.bidsOnLot, lotEndsAt: room.lotEndsAt,
    soldMap: room.soldMap, managers, myManagerId: meId
  };
}

function mergeHof(hof, room, recordDraft, championId){
  hof.managers = hof.managers || {};
  Object.entries(room.managers).forEach(([id,m])=>{
    const key = m.clientId;
    if(!hof.managers[key]) hof.managers[key] = {displayName:m.name, nights:0, wins:0, draws:0, losses:0, titles:0, bestSquadSpend:0, priciestBuy:0};
    const h = hof.managers[key];
    h.displayName = m.name;
    const d = (recordDraft && recordDraft[id]) || {wins:0,draws:0,losses:0};
    h.nights += 1; h.wins += (d.wins||0); h.draws += (d.draws||0); h.losses += (d.losses||0);
    if(championId===id) h.titles += 1;
    if((m.spent||0)>h.bestSquadSpend) h.bestSquadSpend = m.spent||0;
    let myMax=0;
    Object.entries(room.soldMap||{}).forEach(([pid,s])=>{ if(s.soldTo===id && s.price>myMax) myMax=s.price; });
    if(myMax>h.priciestBuy) h.priciestBuy = myMax;
  });
  const rec = computeRecords(room);
  hof.log = hof.log || [];
  hof.log.unshift({
    date: new Date().toLocaleDateString(), code: room.code,
    mostExpensive: rec.mostExp ? {name:rec.mostExp.n, price:rec.mostExp.price} : null,
    bargain: rec.bargain ? {name:rec.bargain.n, price:rec.bargain.price, ovr:rec.bargain.o} : null,
    priciestSquad: {name:rec.bestSquad.name, spent:rec.bestSquad.spent},
    champion: (room.managers[championId]||{}).name || "",
    totalSpent: rec.totalSpent
  });
  hof.log = hof.log.slice(0,50);
  return hof;
}

module.exports = {
  createRoom, findManagerByClient, joinAsManager, startAuction, placeBid, finalizeLot,
  pickFormation, movePlayerToSlot, autofillSlots, lockSquad, autoLockManager,
  computeRecords, redactRoomFor, mergeHof, LOT_SECONDS, REBID_SECONDS, SQUAD_SECONDS
};
