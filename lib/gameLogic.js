const { PLAYERS, FORMATIONS, BUDGET, buildOrder, nextIncrement, AUCTION_POS_RANK } = require("./gameData");

const LOT_SECONDS = 12;
const REBID_SECONDS = 10;
const SQUAD_SECONDS = 120;
const MAX_SQUAD = 11;

function createRoom(code, hostClientId){
  return {
    code, hostClientId, phase:"lobby", createdAt: Date.now(),
    managers: {}, order: null, cur: 0, currentPrice: 0, currentBidder: null,
    bidsOnLot: 0, lotEndsAt: 0, soldMap: {}, passed: {}, switchRequest: null
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
  room.passed = {};
  room.lotEndsAt = Date.now()+LOT_SECONDS*1000;
  room.phase = "auction";
  return {};
}
function placeBid(room, clientId, managerId){
  if(room.phase!=="auction") return {error:"The auction isn't running right now."};
  const m = room.managers[managerId];
  if(!m || m.clientId!==clientId) return {error:"That's not your manager seat."};
  if(room.currentBidder===managerId) return {error:"You're already the highest bidder."};
  if(m.squad.length>=MAX_SQUAD) return {error:"Your squad is already full (11 players)."};
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
/** A manager signals they're not bidding on this lot. Once every manager
 * who COULD still bid (not the current leader, not already full at 11
 * players) has either passed or is full, the lot resolves immediately
 * instead of waiting out the clock. */
function passLot(room, clientId){
  if(room.phase!=="auction") return {error:"The auction isn't running right now."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const [id, m] = e;
  if(room.currentBidder===id) return {error:"You're already the highest bidder."};
  room.passed = room.passed || {};
  if(m.squad.length<MAX_SQUAD) room.passed[id] = true;
  const allPassed = Object.entries(room.managers).every(([mid, mgr])=>{
    if(mid===room.currentBidder) return true;
    if(mgr.squad.length>=MAX_SQUAD) return true;
    return !!room.passed[mid];
  });
  return {allPassed};
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
    endAuctionIntoSwitchWindow(room);
  } else {
    const nextP = PLAYERS[order[room.cur]];
    room.currentPrice = nextP.base;
    room.currentBidder = null;
    room.bidsOnLot = 0;
    room.passed = {};
    room.lotEndsAt = Date.now()+LOT_SECONDS*1000;
  }
  return {};
}
function endAuctionIntoSwitchWindow(room){
  room.phase = "switch";
  room.currentBidder = null;
  room.passed = {};
  room.switchRequest = null;
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
/**
 * Host control: resolve whatever's currently up for bid exactly as normal
 * (sold to the leader, or passed if nobody bid), then bulk-pass every
 * remaining player in that same auction group (e.g. the rest of the
 * goalkeepers) and jump straight to the first player of the next group.
 */
function skipToNextCategory(room, clientId){
  if(room.hostClientId!==clientId) return {error:"Only the host can do that."};
  if(room.phase!=="auction") return {error:"The auction isn't running right now."};
  const order = room.order;
  if(!order || room.cur>=order.length) return {};
  const currentRank = AUCTION_POS_RANK[PLAYERS[order[room.cur]].pos] || 99;

  finalizeLot(room, {});

  if(room.phase==="auction"){
    while(room.cur<order.length && (AUCTION_POS_RANK[PLAYERS[order[room.cur]].pos]||99)===currentRank){
      room.soldMap[order[room.cur]] = {soldTo:null, price:0, bids:0};
      room.cur++;
    }
    if(room.cur>=order.length){
      endAuctionIntoSwitchWindow(room);
    } else {
      const nextP = PLAYERS[order[room.cur]];
      room.currentPrice = nextP.base;
      room.currentBidder = null;
      room.bidsOnLot = 0;
      room.passed = {};
      room.lotEndsAt = Date.now()+LOT_SECONDS*1000;
    }
  }
  return {};
}
/* ============================================================ SWITCH REQUEST WORKFLOW (post-auction "I bought the wrong player" fix) ============================================================
 * One request is processed at a time. Flow:
 *   1. requestSwitch          -> voting
 *   2. voteSwitch (each other manager) -> approved (chooseCategory) or rejected (cleared)
 *   3. chooseSwitchCategory   -> awaitingOffers
 *   4. submitSwitchOffer (any other manager, any number of times/managers)
 *   5. acceptSwitchOffer      -> swap executed, request cleared
 *      or cancelSwitch        -> request cleared, no swap
 */
function requestSwitch(room, clientId){
  if(room.phase!=="switch") return {error:"The trade window isn't open."};
  if(room.switchRequest) return {error:"Another request is already being handled — wait your turn."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  room.switchRequest = {requesterId:e[0], status:"voting", votes:{}, category:null, offers:[]};
  return {};
}
function voteSwitch(room, clientId, vote){
  const sr = room.switchRequest;
  if(!sr || sr.status!=="voting") return {error:"There's nothing to vote on right now."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const id = e[0];
  if(id===sr.requesterId) return {error:"You can't vote on your own request."};
  if(vote!=="yes" && vote!=="no") return {error:"Invalid vote."};
  sr.votes[id] = vote;
  const others = Object.keys(room.managers).filter(mid=>mid!==sr.requesterId);
  const allVoted = others.every(mid=>sr.votes[mid]!==undefined);
  if(allVoted){
    const yes = others.filter(mid=>sr.votes[mid]==="yes").length;
    const no = others.length-yes;
    if(yes>no){ sr.status = "chooseCategory"; return {resolved:"approved"}; }
    room.switchRequest = null;
    return {resolved:"rejected"};
  }
  return {};
}
function chooseSwitchCategory(room, clientId, category){
  const sr = room.switchRequest;
  if(!sr || sr.status!=="chooseCategory") return {error:"Not ready to choose a category yet."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  if(e[0]!==sr.requesterId) return {error:"Only the requester can choose the category."};
  if(!["GK","DEF","MID","FWD"].includes(category)) return {error:"Unknown category."};
  sr.category = category;
  sr.status = "awaitingOffers";
  sr.offers = [];
  return {};
}
function submitSwitchOffer(room, clientId, playerId, price){
  const sr = room.switchRequest;
  if(!sr || sr.status!=="awaitingOffers") return {error:"Not accepting offers right now."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const id = e[0];
  if(id===sr.requesterId) return {error:"You can't make an offer on your own request."};
  const p = PLAYERS[playerId];
  if(!p || p.cat!==sr.category) return {error:"That player isn't in the chosen category."};
  const sold = room.soldMap[playerId];
  if(sold && sold.soldTo) return {error:"That player was already bought during the auction."};
  price = Math.max(0, Math.round(Number(price)||0));
  if(!price) return {error:"Enter a valid price."};
  sr.offers = sr.offers.filter(o=>o.fromManagerId!==id);
  sr.offers.push({fromManagerId:id, playerId, price});
  return {};
}
function acceptSwitchOffer(room, clientId, offerIndex, removePlayerId){
  const sr = room.switchRequest;
  if(!sr || sr.status!=="awaitingOffers") return {error:"There's no offer to accept right now."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  const [id, m] = e;
  if(id!==sr.requesterId) return {error:"Only the requester can accept an offer."};
  const offer = sr.offers[offerIndex];
  if(!offer) return {error:"That offer no longer exists."};
  if(!m.squad.includes(removePlayerId)) return {error:"You don't own that player."};
  const remaining = m.budget-m.spent;
  if(remaining<offer.price) return {error:"You don't have enough budget for that price."};

  m.spent += offer.price;
  m.squad = m.squad.filter(pid=>pid!==removePlayerId).concat([offer.playerId]);
  Object.keys(m.slots||{}).forEach(k=>{ if(m.slots[k]===removePlayerId) delete m.slots[k]; });
  room.soldMap[offer.playerId] = {soldTo:id, price:offer.price, bids:0};

  room.switchRequest = null;
  return {ok:true};
}
function cancelSwitch(room, clientId){
  const sr = room.switchRequest;
  if(!sr) return {error:"No active request to cancel."};
  const e = findManagerByClient(room, clientId); if(!e) return {error:"You haven't joined this room."};
  if(e[0]!==sr.requesterId) return {error:"Only the requester can cancel their own request."};
  room.switchRequest = null;
  return {};
}
function endSwitchWindow(room, clientId){
  if(room.hostClientId!==clientId) return {error:"Only the host can do that."};
  if(room.phase!=="switch") return {error:"The trade window isn't open."};
  if(room.switchRequest) return {error:"Resolve the current request first."};
  room.phase = "squad";
  const deadline = Date.now()+SQUAD_SECONDS*1000;
  Object.values(room.managers).forEach(m=>{ m.squadDeadline = deadline; });
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
    soldMap: room.soldMap, managers, myManagerId: meId,
    passed: room.passed || {}, switchRequest: redactSwitchRequest(room.switchRequest, meId)
  };
}
function redactSwitchRequest(sr, meId){
  if(!sr) return null;
  const votesOut = {};
  const revealVotes = sr.status!=="voting";
  Object.keys(sr.votes).forEach(mid=>{ votesOut[mid] = revealVotes ? sr.votes[mid] : "cast"; });
  return {
    requesterId: sr.requesterId, status: sr.status, votes: votesOut,
    category: sr.category, offers: sr.offers, isMine: sr.requesterId===meId
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
  createRoom, findManagerByClient, joinAsManager, startAuction, placeBid, passLot, finalizeLot, skipToNextCategory,
  pickFormation, movePlayerToSlot, autofillSlots, lockSquad, autoLockManager,
  requestSwitch, voteSwitch, chooseSwitchCategory, submitSwitchOffer, acceptSwitchOffer, cancelSwitch, endSwitchWindow,
  computeRecords, redactRoomFor, mergeHof, LOT_SECONDS, REBID_SECONDS, SQUAD_SECONDS, MAX_SQUAD
};
