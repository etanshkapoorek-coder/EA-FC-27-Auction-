// Shared FC27 player data + constants. This is the single source of truth —
// the client fetches it from GET /api/config rather than keeping its own copy.

const RAW_PLAYERS = [
["Kylian Mbappé","Real Madrid","ST",91],["Erling Haaland","Manchester City","ST",91],
["Ousmane Dembélé","PSG","ST",90],["Rodri","Manchester City","CDM",90],
["Jude Bellingham","Real Madrid","CAM",90],["Lamine Yamal","FC Barcelona","RM",90],
["Vitinha","PSG","CM",90],["Pedri","FC Barcelona","CM",90],
["Harry Kane","Bayern Munich","ST",90],["Thibaut Courtois","Real Madrid","GK",90],
["Michael Olise","Bayern Munich","RM",90],["Gianluigi Donnarumma","Manchester City","GK",89],
["Vini Jr.","Real Madrid","LW",89],["Gabriel","Arsenal","CB",89],
["Khvicha Kvaratskhelia","PSG","LW",89],["Bruno Fernandes","Manchester United","CAM",89],
["Nuno Mendes","PSG","LB",89],["Willian Pacho","PSG","CB",89],
["Lionel Messi","Inter Miami","RW",89],["Virgil van Dijk","Liverpool","CB",88],
["Raphinha","FC Barcelona","LM",88],["Achraf Hakimi","PSG","RB",88],
["Joshua Kimmich","Bayern Munich","CDM",88],["Jan Oblak","Atlético Madrid","GK",88],
["Declan Rice","Arsenal","CDM",88],["William Saliba","Arsenal","CB",88],
["João Neves","PSG","CM",88],["Luis Díaz","Bayern Munich","LM",88],
["Mohamed Salah","Liverpool","RM",87],["Alisson","Liverpool","GK",87],
["Federico Valverde","Real Madrid","CM",87],["Lautaro Martínez","Brescia","ST",87],
["Jamal Musiala","Bayern Munich","CAM",87],["Bukayo Saka","Arsenal","RW",87],
["Marquinhos","PSG","CB",87],["Jonathan Tah","Bayern Munich","CB",87],
["Mike Maignan","Inter Milan","GK",87],["David Raya","Arsenal","GK",88],
["Nicolò Barella","Brescia","CM",87],["Rúben Dias","Manchester City","CB",87],
["Gregor Kobel","Borussia Dortmund","GK",87],["Nico Schlotterbeck","Borussia Dortmund","CB",87],
["Dayot Upamecano","Bayern Munich","CB",87],["Florian Wirtz","Liverpool","CAM",86],
["Alexander Isak","Liverpool","ST",86],["Alessandro Bastoni","Brescia","CB",86],
["Frenkie de Jong","FC Barcelona","CM",86],["Moisés Caicedo","Chelsea","CDM",86],
["Yann Sommer","Club Brugge","GK",86],["Jules Koundé","FC Barcelona","RB",86],
["Julián Álvarez","Atlético Madrid","ST",86],["Martin Ødegaard","Arsenal","CM",86],
["Viktor Gyökeres","Arsenal","ST",86],["Victor Osimhen","Galatasaray","ST",86],
["Bruno Guimarães","Arsenal","CM",86],["Federico Dimarco","Brescia","LB",86],
["Scott McTominay","Napoli","CM",86],["Ryan Gravenberch","Liverpool","CDM",85],
["Désiré Doué","PSG","RW",86],["Fabián Ruiz","PSG","CM",86],
["Bremer","Juventus","CB",86],["Marc Cucurella","Chelsea","LB",86],
["Enzo Fernández","Chelsea","CM",86],["Marco Carnesecchi","Atalanta","GK",86],
["Dominik Szoboszlai","Liverpool","CAM",86],["Joan García","FC Barcelona","GK",86],
["Pau Cubarsí","FC Barcelona","CB",86],["Rayan Cherki","Manchester City","RW",86],
["Cole Palmer","Chelsea","CAM",85],["Serhou Guirassy","Borussia Dortmund","ST",85],
["Kevin De Bruyne","Napoli","CM",85],["Alexis Mac Allister","Liverpool","CM",84],
["Trent Alexander-Arnold","Real Madrid","RB",85],["Paulo Dybala","AS Roma","CAM",85],
["Hakan Çalhanoğlu","Brescia","CDM",85],["Sandro Tonali","Tottenham","CDM",85],
["Tijjani Reijnders","Manchester City","CM",85],["Emiliano Martínez","Aston Villa","GK",85],
["Bryan Mbeumo","Manchester United","RW",85],["Unai Simón","Athletic Club","GK",85],
["Marcus Thuram","Brescia","ST",85],["Phil Foden","Manchester City","RW",85],
["Youri Tielemans","Manchester United","CM",85],["Granit Xhaka","Sunderland","CDM",85],
["Marcos Llorente","Atlético Madrid","RB",85],["Jordan Pickford","Everton","GK",85],
["Joško Gvardiol","Manchester City","LB",85],["Grimaldo","Bayer Leverkusen","LM",85],
["Rúben Neves","Al Hilal","CDM",85],["Bradley Barcola","PSG","LW",85],
["Adrien Rabiot","Inter Milan","CAM",85],["Luka Modrić","Inter Milan","CM",85],
["Zubimendi","Arsenal","CDM",85],["Hugo Ekitiké","Liverpool","ST",85],
["Mile Svilar","AS Roma","GK",85],["Konrad Laimer","Bayern Munich","RB",85],
["Antoine Semenyo","Manchester City","RM",85],["Fermín","FC Barcelona","CAM",85],
["Deniz Undav","VfB Stuttgart","ST",85],["Eric García","FC Barcelona","CB",85],
["Giorgi Mamardashvili","Liverpool","GK",83],["Cody Gakpo","Liverpool","LM",82],
["Jeremie Frimpong","Liverpool","RB",81],["Milos Kerkez","Liverpool","LB",81],
["Federico Chiesa","Liverpool","RM",80],["Curtis Jones","Liverpool","CM",80],
["Víctor Muñoz","Liverpool","LM",79],["Joe Gomez","Liverpool","CB",79],
["Conor Bradley","Liverpool","RB",79],["Wataru Endo","Liverpool","CDM",78],
["Harvey Elliott","Liverpool","CAM",77],["Kostas Tsimikas","Liverpool","LB",76],
["Eberechi Eze","Arsenal","CAM",84],["Jurriën Timber","Arsenal","RB",84],
["Piero Hincapié","Arsenal","LB",84],["Mikel Merino","Arsenal","CM",83],
["Christos Tzolis","Arsenal","LW",82],["Riccardo Calafiori","Arsenal","LB",82],
["Benjamin White","Arsenal","RB",81],["Kai Havertz","Arsenal","ST",81],
["Gabriel Martinelli","Arsenal","LW",80],["Noni Madueke","Arsenal","RW",80],
["Christian Nørgaard","Arsenal","CDM",79],["Gabriel Jesus","Arsenal","ST",79],
["Kepa Arrizabalaga","Arsenal","GK",78],["Fábio Vieira","Arsenal","CAM",78],
["Cristhian Mosquera","Arsenal","CB",78],["Myles Lewis-Skelly","Arsenal","LB",78],
["Reiss Nelson","Arsenal","RM",75],["Ethan Nwaneri","Arsenal","RW",75],
["Reece James","Chelsea","RB",84],["João Pedro","Chelsea","ST",83],
["Maxence Lacroix","Chelsea","CB",82],["Pedro Neto","Chelsea","RW",81],
["Estêvão","Chelsea","RW",80],["Danny Welbeck","Chelsea","ST",80],
["Robert Sánchez","Chelsea","GK",80],["Levi Colwill","Chelsea","CB",80],
["Matvey Safonov","PSG","GK",83],["Warren Zaïre-Emery","PSG","CM",83],
["Nico Williams","Athletic Club","RW",84],["Aurélien Tchouaméni","Real Madrid","CDM",84],
["Rodrygo","Real Madrid","RW",84],["Mikel Oyarzabal","Real Sociedad","ST",84],
["Aymeric Laporte","Athletic Club","CB",84],["Ibrahima Konaté","FC Barcelona","CB",84],
["Isco","Real Betis","CAM",83],["Péter Gulácsi","Villarreal","GK",82],
["Antonio Rüdiger","Real Madrid","CB",85],["Xavi Simons","PSG","CAM",84],
["Robert Lewandowski","FC Barcelona","ST",84],["Antoine Griezmann","Atlético Madrid","CAM",84]
];

function catOf(pos){
  if(pos==="GK") return "GK";
  if(["CB","LB","RB"].includes(pos)) return "DEF";
  if(["CM","CDM","CAM"].includes(pos)) return "MID";
  return "FWD"; // ST, LW, RW, LM, RM
}
const BASE_PRICE = {GK:500000, DEF:1000000, MID:3000000, FWD:5000000};
const CAT_LABEL = {GK:"Goalkeeper", DEF:"Defender", MID:"Midfielder", FWD:"Forward"};

const PLAYERS = RAW_PLAYERS.map((p,i)=>{
  const cat = catOf(p[2]);
  return {id:i, n:p[0], c:p[1], pos:p[2], o:p[3], cat, base:BASE_PRICE[cat]};
});

const FORMATIONS = [
  {name:"4-4-2", def:4, mid:4, fwd:2}, {name:"4-3-3", def:4, mid:3, fwd:3},
  {name:"4-2-3-1", def:4, mid:5, fwd:1}, {name:"3-5-2", def:3, mid:5, fwd:2},
  {name:"5-3-2", def:5, mid:3, fwd:2}, {name:"3-4-3", def:3, mid:4, fwd:3},
];
const BUDGET = 100000000;

// Auction order, most senior groups first, highest rated within each group:
//   1. Goalkeepers
//   2. Full backs — LB, RB
//   3. Centre backs — CB
//   4. Defensive midfielders — CDM, CM
//   5. Attacking midfielders — CAM
//   6. Wingers — LW, LM, RW, RM
//   7. Strikers — ST
const AUCTION_POS_RANK = {
  GK:1,
  LB:2, RB:2,
  CB:3,
  CDM:4, CM:4,
  CAM:5,
  LW:6, LM:6, RW:6, RM:6,
  ST:7,
};
function buildOrder(eligibleIds){
  const ids = eligibleIds || PLAYERS.map(p=>p.id);
  return ids.slice().sort((a,b)=>{
    const pa=PLAYERS[a], pb=PLAYERS[b];
    const ra = AUCTION_POS_RANK[pa.pos] || 99, rb = AUCTION_POS_RANK[pb.pos] || 99;
    if(ra!==rb) return ra-rb;
    return pb.o - pa.o;
  });
}
function nextIncrement(price){
  if(price<1000000) return 100000;
  if(price<3000000) return 250000;
  if(price<6000000) return 500000;
  if(price<15000000) return 1000000;
  if(price<30000000) return 2000000;
  return 5000000;
}

module.exports = { PLAYERS, BASE_PRICE, CAT_LABEL, FORMATIONS, BUDGET, catOf, buildOrder, nextIncrement, AUCTION_POS_RANK };
