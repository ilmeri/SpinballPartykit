// server.js — PartyKit game server for SpinBalls
// Physics and game logic ported from index.html

// ===== Physics Constants (tunable at runtime) =====
let FRIC = 0.982, REST = 0.78;
const MIN_V = 0.15;
let MAX_POW = 16, POW_RATE = 20;
let ROT_SPD = 2.8;
let PR = 18, BR = 12;
const PMASS = 3, BMASS = 1;
const WIN_SCORE = 5;

const ST_ROT = 0, ST_AIM = 1;

// ===== Field Geometry =====
const W = 960, H = 640;
const FM = 60;
const FL = FM, FT = FM, FR = W - FM, FB = H - FM;
const FCX = (FL + FR) / 2, FCY = (FT + FB) / 2;

// ===== Goals =====
const GH = 160, GD = 34;
const GT = FCY - GH / 2, GB = FCY + GH / 2;

const goalPosts = [
  { x: FL, y: GT, r: 5 }, { x: FL, y: GB, r: 5 },
  { x: FR, y: GT, r: 5 }, { x: FR, y: GB, r: 5 }
];

const FILL_ORDER = [0, 2, 1, 3];
const FDT = 1 / 60;
const SYNC_INTERVAL = 3;
const GOAL_PAUSE = 2.0;
const AUTO_REMATCH_DELAY = 3.0;

// ===== Physics Functions =====
function circleCol(a, b, am, bm) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minD = a.r + b.r;
  if (dist >= minD || dist === 0) return false;
  const nx = dx / dist, ny = dy / dist;
  const overlap = minD - dist;
  const inv = 1 / am + 1 / bm;
  a.x -= overlap * (1 / am) / inv * nx;
  a.y -= overlap * (1 / am) / inv * ny;
  b.x += overlap * (1 / bm) / inv * nx;
  b.y += overlap * (1 / bm) / inv * ny;
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  const dvn = dvx * nx + dvy * ny;
  if (dvn <= 0) return true;
  const j = (1 + REST) * dvn / inv;
  a.vx -= j * nx / am; a.vy -= j * ny / am;
  b.vx += j * nx / bm; b.vy += j * ny / bm;
  return true;
}

function postCol(ball) {
  for (const post of goalPosts) {
    const dx = ball.x - post.x, dy = ball.y - post.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minD = ball.r + post.r;
    if (dist < minD && dist > 0) {
      const nx = dx / dist, ny = dy / dist;
      ball.x = post.x + nx * minD; ball.y = post.y + ny * minD;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) { ball.vx -= (1 + REST) * dot * nx; ball.vy -= (1 + REST) * dot * ny; }
    }
  }
}

function wallBounce(b) {
  const r = b.r;
  if (b.y - r < FT) { b.y = FT + r; if (b.vy < 0) b.vy *= -REST; }
  if (b.y + r > FB) { b.y = FB - r; if (b.vy > 0) b.vy *= -REST; }
  const inGoalY = b.y >= GT && b.y <= GB;
  if (b.x - r < FL) {
    if (inGoalY) {
      if (b.x - r < FL - GD) { b.x = FL - GD + r; if (b.vx < 0) b.vx *= -REST; }
    } else { b.x = FL + r; if (b.vx < 0) b.vx *= -REST; }
  }
  if (b.x < FL && b.x > FL - GD - r) {
    if (b.y - r < GT) { b.y = GT + r; if (b.vy < 0) b.vy *= -REST; }
    if (b.y + r > GB) { b.y = GB - r; if (b.vy > 0) b.vy *= -REST; }
  }
  if (b.x + r > FR) {
    if (inGoalY) {
      if (b.x + r > FR + GD) { b.x = FR + GD - r; if (b.vx > 0) b.vx *= -REST; }
    } else { b.x = FR - r; if (b.vx > 0) b.vx *= -REST; }
  }
  if (b.x > FR && b.x < FR + GD + r) {
    if (b.y - r < GT) { b.y = GT + r; if (b.vy < 0) b.vy *= -REST; }
    if (b.y + r > GB) { b.y = GB - r; if (b.vy > 0) b.vy *= -REST; }
  }
}

function checkGoal(fb) {
  if (fb.x < FL && fb.y > GT && fb.y < GB) return 1; // Red scores (ball in left goal)
  if (fb.x > FR && fb.y > GT && fb.y < GB) return 0; // Blue scores (ball in right goal)
  return -1;
}

// ===== Player (physics only, no rendering) =====
class Player {
  constructor(sx, sy, idx, team) {
    this.sx = sx; this.sy = sy;
    this.x = sx; this.y = sy; this.vx = 0; this.vy = 0;
    this.r = PR; this.mass = PMASS;
    this.idx = idx; this.team = team;
    this.angle = Math.random() * Math.PI * 2;
    this.power = 0; this.state = ST_ROT;
    this.occupied = false;
    this.shootMode = 0;
  }
  reset() {
    this.x = this.sx; this.y = this.sy; this.vx = 0; this.vy = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.power = 0; this.state = ST_ROT;
  }
  update(dt) {
    if (this.occupied) {
      if (this.shootMode === 0 && this.state === ST_ROT) this.angle += ROT_SPD * dt;
      if (this.state === ST_AIM) this.power = Math.min(this.power + POW_RATE * dt, MAX_POW);
    }
    this.x += this.vx; this.y += this.vy;
    this.vx *= FRIC; this.vy *= FRIC;
    if (Math.abs(this.vx) < MIN_V && Math.abs(this.vy) < MIN_V) { this.vx = 0; this.vy = 0; }
  }
  shoot() {
    const p = Math.max(this.power, 1);
    this.vx += Math.cos(this.angle) * p;
    this.vy += Math.sin(this.angle) * p;
    this.state = ST_ROT; this.power = 0;
  }
}

function makeFb() { return { x: FCX, y: FCY, vx: 0, vy: 0, r: BR, mass: BMASS }; }

function updateFb(fb) {
  fb.x += fb.vx; fb.y += fb.vy;
  fb.vx *= FRIC; fb.vy *= FRIC;
  if (Math.abs(fb.vx) < MIN_V && Math.abs(fb.vy) < MIN_V) { fb.vx = 0; fb.vy = 0; }
}

// ===== PartyKit Server =====
export default class Server {
  constructor(room) {
    this.room = room;
    this.players = [];
    this.fb = null;
    this.lastToucher = null;
    this.teamScores = [0, 0];
    this.goalScoredBy = null;
    this.goalTimer = 0;
    this.winner = null;
    this.gameState = 'WAITING';
    this.slots = [null, null, null, null];
    this.names = ['', '', '', ''];
    this.syncCounter = 0;
    this.loopInterval = null;
    this.rematchVotes = new Set();
    this.shootModes = [0, 0, 0, 0];
    this.autoRematchTimer = 0;
    // Announcer tracking
    this.playerGoals = [0, 0, 0, 0];
    this.lastKickoffTime = 0;
    this.lastAnnouncerEventTime = 0;
    this.playTimer = 0;
  }

  get isQuickplay() {
    return this.room.id === 'quickplay';
  }

  initGame() {
    const I = 60;
    this.players = [
      new Player(FL + I, FT + I, 0, 0),
      new Player(FL + I, FB - I, 1, 0),
      new Player(FR - I, FT + I, 2, 1),
      new Player(FR - I, FB - I, 3, 1),
    ];
    this.fb = makeFb();
    this.lastToucher = null;
    this.teamScores = [0, 0];
    this.goalScoredBy = null;
    this.goalTimer = 0;
    this.winner = null;
    this.playerGoals = [0, 0, 0, 0];
    this.lastKickoffTime = Date.now();
    this.playTimer = 0;
    for (let i = 0; i < 4; i++) {
      this.players[i].occupied = this.slots[i] !== null;
      this.players[i].shootMode = this.shootModes[i];
    }
  }

  resetField() {
    for (const p of this.players) p.reset();
    this.fb = makeFb();
    this.lastToucher = null;
    this.goalScoredBy = null;
    this.goalTimer = 0;
    this.lastKickoffTime = Date.now();
    this.playTimer = 0;
  }

  canAnnounce(minGap = 8000) {
    const now = Date.now();
    if (now - this.lastAnnouncerEventTime < minGap) return false;
    this.lastAnnouncerEventTime = now;
    return true;
  }

  packState() {
    const buf = new Array(37);
    for (let i = 0; i < 4; i++) {
      const p = this.players[i], o = i * 7;
      buf[o] = p.x; buf[o+1] = p.y; buf[o+2] = p.vx; buf[o+3] = p.vy;
      buf[o+4] = p.angle; buf[o+5] = p.power; buf[o+6] = p.state;
    }
    buf[28] = this.fb.x; buf[29] = this.fb.y; buf[30] = this.fb.vx; buf[31] = this.fb.vy;
    buf[32] = this.lastToucher ? this.lastToucher.idx : -1;
    buf[33] = this.teamScores[0]; buf[34] = this.teamScores[1];
    buf[35] = this.goalScoredBy ? this.goalScoredBy.team : -1;
    buf[36] = this.goalTimer;
    return buf;
  }

  startLoop() {
    if (this.loopInterval) return;
    this.loopInterval = setInterval(() => this.tick(), 1000 / 60);
  }

  stopLoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  tick() {
    if (this.gameState === 'GAME_OVER') {
      if (this.isQuickplay) {
        this.autoRematchTimer -= FDT;
        this.syncCounter++;
        if (this.syncCounter % 30 === 0) {
          this.broadcast({ type: 'countdown', secs: Math.ceil(Math.max(this.autoRematchTimer, 0)) });
        }
        if (this.autoRematchTimer <= 0) {
          this.autoRematchTimer = 0;
          this.startNewGame();
        }
      }
      return;
    }

    if (this.gameState !== 'PLAYING') return;

    // Goal celebration: count down timer, keep broadcasting state
    if (this.goalScoredBy) {
      this.goalTimer -= FDT;
      if (this.goalTimer <= 0) {
        if (this.winner) {
          // Game over — send final state then gameover message
          this.broadcast({ type: 'state', data: this.packState() });
          const scorerIdx = this.lastToucher ? this.lastToucher.idx : -1;
          const scorer = scorerIdx >= 0 ? (this.names[scorerIdx] || '') : '';
          this.broadcast({
            type: 'gameover',
            winner: { team: this.winner.team, scorer },
            scores: [...this.teamScores]
          });
          this.broadcast({ type: 'event', event: 'gameOver',
            winnerTeam: this.winner.team,
            scores: [...this.teamScores],
            names: [...this.names],
            playerGoals: [...this.playerGoals]
          });
          this.gameState = 'GAME_OVER';
          if (this.isQuickplay) {
            this.autoRematchTimer = AUTO_REMATCH_DELAY;
            this.syncCounter = 0;
          }
          return;
        } else {
          this.resetField();
        }
      }
      this.syncCounter++;
      if (this.syncCounter >= SYNC_INTERVAL) {
        this.syncCounter = 0;
        this.broadcast({ type: 'state', data: this.packState() });
      }
      return;
    }

    // Save pre-physics state for announcer detection
    const prevFbVx = this.fb.vx, prevFbVy = this.fb.vy;
    const prevToucher = this.lastToucher;

    // Full authoritative physics
    for (const p of this.players) p.update(FDT);
    updateFb(this.fb);
    for (const p of this.players) wallBounce(p);
    wallBounce(this.fb);
    for (const p of this.players) postCol(p);
    const fbVxPre = this.fb.vx, fbVyPre = this.fb.vy;
    postCol(this.fb);
    const postHit = (this.fb.vx !== fbVxPre || this.fb.vy !== fbVyPre);
    for (let i = 0; i < this.players.length; i++)
      for (let j = i + 1; j < this.players.length; j++)
        circleCol(this.players[i], this.players[j], PMASS, PMASS);
    for (const p of this.players)
      if (circleCol(p, this.fb, PMASS, BMASS)) this.lastToucher = p;

    // Announcer: save detection
    if (this.lastToucher && this.lastToucher !== prevToucher) {
      const saver = this.lastToucher;
      const speed = Math.sqrt(prevFbVx * prevFbVx + prevFbVy * prevFbVy);
      const toOwnGoal = (saver.team === 0 && prevFbVx < -2) || (saver.team === 1 && prevFbVx > 2);
      if (toOwnGoal && speed > 4 && this.canAnnounce(10000)) {
        this.broadcast({ type: 'event', event: 'save',
          saver: this.names[saver.idx], saverTeam: saver.team,
          scores: [...this.teamScores] });
      }
    }

    // Announcer: near miss (post bounce near goal)
    if (postHit && this.fb.y > GT && this.fb.y < GB) {
      const speed = Math.sqrt(fbVxPre * fbVxPre + fbVyPre * fbVyPre);
      const nearLeft = this.fb.x < FL + 15;
      const nearRight = this.fb.x > FR - 15;
      if ((nearLeft || nearRight) && speed > 3 && this.canAnnounce(10000)) {
        this.broadcast({ type: 'event', event: 'nearMiss',
          scores: [...this.teamScores] });
      }
    }

    // Announcer: periodic color commentary
    this.playTimer += FDT;
    if (this.playTimer >= 25 && this.canAnnounce(20000)) {
      this.playTimer = 0;
      this.broadcast({ type: 'event', event: 'commentary',
        scores: [...this.teamScores], names: [...this.names],
        playerGoals: [...this.playerGoals] });
    }

    // Check goals
    const scoringTeam = checkGoal(this.fb);
    if (scoringTeam >= 0) {
      this.teamScores[scoringTeam]++;
      this.goalScoredBy = { team: scoringTeam };
      this.goalTimer = GOAL_PAUSE;
      const gScorerIdx = this.lastToucher ? this.lastToucher.idx : -1;
      if (gScorerIdx >= 0) this.playerGoals[gScorerIdx]++;
      const timeSinceKickoff = (Date.now() - this.lastKickoffTime) / 1000;
      if (this.teamScores[scoringTeam] >= WIN_SCORE) {
        this.winner = { team: scoringTeam };
      }
      this.broadcast({ type: 'event', event: 'goal',
        scorer: gScorerIdx >= 0 ? this.names[gScorerIdx] : '',
        scorerTeam: scoringTeam,
        scores: [...this.teamScores],
        quickGoal: timeSinceKickoff < 4,
        isMatchPoint: this.teamScores[scoringTeam] === WIN_SCORE - 1 && !this.winner,
        isGameOver: !!this.winner
      });
      this.playTimer = 0;
      this.lastAnnouncerEventTime = Date.now();
    }

    // Broadcast state at 20Hz
    this.syncCounter++;
    if (this.syncCounter >= SYNC_INTERVAL) {
      this.syncCounter = 0;
      this.broadcast({ type: 'state', data: this.packState() });
    }
  }

  startNewGame() {
    this.initGame();
    this.gameState = 'PLAYING';
    this.rematchVotes.clear();
    this.syncCounter = 0;
    this.broadcast({ type: 'start', slots: this.slots, names: this.names });
    this.broadcast({ type: 'event', event: 'gameStart',
      names: [...this.names], slots: [...this.slots] });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const conn of this.room.getConnections()) {
      conn.send(data);
    }
  }

  send(conn, msg) {
    conn.send(JSON.stringify(msg));
  }

  onConnect(conn, ctx) {
    // Assign a slot
    let assignedSlot = -1;
    for (const fi of FILL_ORDER) {
      if (this.slots[fi] === null) {
        this.slots[fi] = conn.id;
        assignedSlot = fi;
        break;
      }
    }

    if (assignedSlot < 0) {
      this.send(conn, { type: 'full' });
      return;
    }

    // Tell the new player their slot
    this.send(conn, { type: 'assign', slot: assignedSlot, slots: this.slots, names: this.names });

    // Tell everyone about the updated lobby
    this.broadcast({ type: 'lobby', slots: this.slots, names: this.names });

    if (this.isQuickplay) {
      if (this.gameState === 'WAITING') {
        // First player — start immediately
        this.initGame();
        this.gameState = 'PLAYING';
        this.startLoop();
        this.broadcast({ type: 'start', slots: this.slots, names: this.names });
      } else if (this.gameState === 'PLAYING' || this.gameState === 'GAME_OVER') {
        // Mid-game join
        if (this.players[assignedSlot]) this.players[assignedSlot].occupied = true;
        this.send(conn, {
          type: 'start', slots: this.slots, names: this.names,
          midGame: true, scores: [...this.teamScores], gameState: this.gameState
        });
      }
    } else {
      // Private room — send mid-game state if game already running
      if (this.gameState === 'PLAYING' || this.gameState === 'GAME_OVER') {
        if (this.players[assignedSlot]) this.players[assignedSlot].occupied = true;
        this.send(conn, {
          type: 'start', slots: this.slots, names: this.names,
          midGame: true, scores: [...this.teamScores], gameState: this.gameState
        });
      }
    }
  }

  onClose(conn) {
    // Find and free the slot
    let slot = -1;
    for (let i = 0; i < 4; i++) {
      if (this.slots[i] === conn.id) { slot = i; break; }
    }
    if (slot < 0) return;

    this.slots[slot] = null;
    this.names[slot] = '';
    this.shootModes[slot] = 0;
    if (this.players[slot]) { this.players[slot].occupied = false; this.players[slot].shootMode = 0; }
    this.rematchVotes.delete(conn.id);

    // Tell remaining players
    this.broadcast({ type: 'lobby', slots: this.slots, names: this.names });

    // Check if rematch votes now satisfy the new total (private rooms)
    const count = this.slots.filter(s => s !== null).length;
    if (this.gameState === 'GAME_OVER' && !this.isQuickplay && count > 0) {
      this.broadcast({ type: 'rematch', votes: this.rematchVotes.size, total: count });
      if (this.rematchVotes.size >= count) {
        this.startNewGame();
      }
    }

    // Empty room — stop and reset
    if (count === 0) {
      this.stopLoop();
      this.gameState = 'WAITING';
      this.rematchVotes.clear();
      this.autoRematchTimer = 0;
    }
  }

  onMessage(message, sender) {
    let msg;
    try { msg = JSON.parse(/** @type {string} */ (message)); } catch { return; }

    // Find sender's slot
    let slot = -1;
    for (let i = 0; i < 4; i++) {
      if (this.slots[i] === sender.id) { slot = i; break; }
    }

    switch (msg.type) {
      case 'input': {
        if (slot < 0 || this.gameState !== 'PLAYING') return;
        const p = this.players[slot];
        if (!p || this.goalScoredBy || this.winner) return;
        if (msg.angle !== undefined) p.angle = msg.angle;
        if (msg.action === 'down' && p.state !== ST_AIM) { p.state = ST_AIM; p.power = 0; }
        else if (msg.action === 'up' && p.state === ST_AIM) p.shoot();
        break;
      }
      case 'mode': {
        if (slot >= 0 && (msg.mode === 0 || msg.mode === 1)) {
          this.shootModes[slot] = msg.mode;
          if (this.players[slot]) this.players[slot].shootMode = msg.mode;
        }
        break;
      }
      case 'name': {
        if (slot >= 0) {
          this.names[slot] = (msg.name || '').replace(/[^a-zA-Z0-9 _\-]/g, '').slice(0, 10);
          this.broadcast({ type: 'lobby', slots: this.slots, names: this.names });
        }
        break;
      }
      case 'start': {
        // Private rooms: any player can start when 2+ present
        if (!this.isQuickplay && this.gameState === 'WAITING') {
          const count = this.slots.filter(s => s !== null).length;
          if (count >= 2) {
            this.startNewGame();
            this.startLoop();
          }
        }
        break;
      }
      case 'rematch': {
        if (this.gameState !== 'GAME_OVER' || this.isQuickplay) return;
        this.rematchVotes.add(sender.id);
        const total = this.slots.filter(s => s !== null).length;
        this.broadcast({ type: 'rematch', votes: this.rematchVotes.size, total });
        if (this.rematchVotes.size >= total) {
          this.startNewGame();
        }
        break;
      }
      case 'params': {
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        if (msg.MAX_POW !== undefined) MAX_POW = clamp(msg.MAX_POW, 4, 40);
        if (msg.POW_RATE !== undefined) POW_RATE = clamp(msg.POW_RATE, 5, 60);
        if (msg.FRIC !== undefined) FRIC = clamp(msg.FRIC, 0.95, 0.999);
        if (msg.ROT_SPD !== undefined) ROT_SPD = clamp(msg.ROT_SPD, 0.5, 8);
        if (msg.REST !== undefined) REST = clamp(msg.REST, 0.3, 1.2);
        if (msg.PR !== undefined) { PR = clamp(msg.PR, 8, 36); this.players.forEach(p => p.r = PR); }
        if (msg.BR !== undefined) { BR = clamp(msg.BR, 6, 24); if (this.fb) this.fb.r = BR; }
        this.broadcast({ type: 'params', MAX_POW, POW_RATE, FRIC, ROT_SPD, REST, PR, BR });
        break;
      }
      case 'announce': {
        if (msg.audio && msg.text) {
          this.broadcast({ type: 'announce', audio: msg.audio, text: msg.text });
        }
        break;
      }
    }
  }
}
