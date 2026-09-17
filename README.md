# FC27 Auction Night

A live multiplayer auction game for drafting an EA SPORTS FC™ 27 squad with
friends, then playing the actual matches in EA FC 27. One person hosts a
room, everyone else joins from their own phone or laptop, and the server
runs the whole auction: countdown timers, bid validation, and — genuinely,
not just in the UI — hidden budgets and hidden squads until reveal.

It also ships a **pass-and-play** mode that needs no other players online:
everyone shares one screen, which is handy if you'd rather not deal with a
room code.

## What's inside

```
server.js          Express + Socket.IO server — the whole game runs here
lib/gameData.js     The 152-player pool, positions, base prices, formations
lib/gameLogic.js     Pure game rules (bidding, squads, records) — no I/O,
                     easy to unit-test on its own
public/              The client: index.html, styles.css, client.js
data/hof.json        Hall of Fame, written by the server (created at runtime)
render.yaml          Optional one-click Render Blueprint
```

Everything the client needs (the player list, base prices, formations,
budget) is fetched from the server at `/api/config` — there's exactly one
copy of the data, on the server, so the client can never drift out of sync
with it.

## Running it locally

```
npm install
npm start
```

Then open `http://localhost:3000` in a couple of browser tabs (or on your
phone via your computer's local IP) to try the live mode with more than one
"player."

## Deploying to Render

**Option A — Blueprint (fastest):**
1. Push this folder to a GitHub (or GitLab) repository.
2. In the Render dashboard, click **New → Blueprint**, point it at the repo.
   Render will read `render.yaml` and set everything up automatically.
3. Click **Apply**. Render installs dependencies (`npm install`) and starts
   the server (`npm start`) for you.

**Option B — Manual Web Service:**
1. Push this folder to a GitHub/GitLab repo.
2. In Render: **New → Web Service** → connect the repo.
3. Settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free is fine to start
4. Deploy. Render gives you a public URL like `https://fc27-auction-night.onrender.com` —
   that's the link everyone opens to play.

No environment variables are required. Render sets `PORT` automatically and
the server reads it (`process.env.PORT`).

### A couple of things worth knowing

- **Rooms live in server memory.** If the service restarts (a new deploy, or
  the free plan spinning down after inactivity), any auction in progress is
  lost. For a casual game night this is rarely an issue — just don't deploy
  mid-auction. The Hall of Fame is written to `data/hof.json` on disk, so it
  *does* survive a restart, but on Render's **free** plan the filesystem
  itself is wiped on redeploy (and possibly on spin-down). If you want the
  Hall of Fame to survive long-term, either:
  - upgrade to a paid Render plan and uncomment the `disk:` block in
    `render.yaml` (mounts a persistent volume at `data/`), or
  - swap `loadHof`/`saveHof` in `server.js` for a real database (Render
    Postgres works well) — the rest of the game logic doesn't care how the
    Hall of Fame is stored.
- **Free plan spin-down.** Render's free web services sleep after periods of
  inactivity and take a few seconds to wake back up on the next request —
  the first person to open the link before a game night might see a short
  delay while it spins up.
- **Privacy is real, not cosmetic.** Because the server holds the
  authoritative game state and sends each browser its own redacted view,
  opponents' budgets and squads are actually never transmitted to your
  browser until the reveal phase — not just hidden by CSS.

## How to play

1. Host opens the site, picks **Play live → Create room**, and shares the
   5-character code.
2. Everyone else opens the same URL, enters the code, and types a manager
   name to join.
3. Host clicks **Start the auction** once at least 2 managers have joined.
   Players come up **goalkeepers → full backs → centre backs → defensive
   mids → attacking mids → wingers → strikers**,
   highest-rated first in each group. Bidding is classic English-auction
   style: highest bid wins once the clock runs out, with the clock resetting
   on every new bid. Each manager can own **at most 11 players** — bidding
   locks automatically once you're full. If everyone who could still bid on
   a player hits **Pass**, the lot resolves immediately instead of waiting
   out the clock.
4. Once the pool is exhausted, there's a **trade window** before squad
   building: if someone realises they bought the wrong mix (two
   goalkeepers, no strikers, whatever), they can request a switch. The rest
   of the group votes; if a majority approves, the requester picks a
   category, the other managers each offer up an unsold player from that
   category at a price of their choosing, and the requester picks one to
   accept (paying that price and dropping one of their own players to make
   room). Anyone can request one at a time, and the host moves things along
   to squad building once everyone's satisfied.
5. Everyone then gets 2 minutes (simultaneously, on their own device) to
   pick a formation and starting XI from the players they own — tap a
   player to select them, then tap the slot you want them in.
6. Once everyone's locked in, all squads are revealed together, along with
   auction records (most expensive signing, biggest bargain, priciest
   squad, biggest bidding war).
7. Go play the actual matches in EA FC 27 with those squads, then come back
   and log the results — wins/draws/losses and who was champion of the
   night — which rolls into the shared **Hall of Fame**.
