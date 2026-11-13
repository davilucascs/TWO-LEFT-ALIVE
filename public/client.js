const socket = io();

// Elementos DOM
const lobbyOverlay = document.getElementById('lobby-overlay');
const menuRainCanvas = document.getElementById('menu-rain-canvas');
const menuRainCtx = menuRainCanvas.getContext('2d');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
const gameCanvas = document.getElementById('game-canvas');
const ctx = gameCanvas.getContext('2d');
const weaponHudCanvas = document.getElementById('weapon-hud-canvas');
const wHudCtx = weaponHudCanvas.getContext('2d');

// Inputs do Menu
const nameInput = document.getElementById('player-name');
const outfitSelect = document.getElementById('outfit-select');
const eyeSelect = document.getElementById('eye-select');
const weaponRadios = document.querySelectorAll('input[name="weapon"]');
const mapSelect = document.getElementById('map-select');
const totalOrdersSelect = document.getElementById('total-orders-select');
const walkerCheck = document.getElementById('enable-walker');
const crawlerCheck = document.getElementById('enable-crawler');
const sprinterCheck = document.getElementById('enable-sprinter');
const reaperCheck = document.getElementById('enable-reaper');
const countSelect = document.getElementById('count-multiplier');
const speedSelect = document.getElementById('speed-multiplier');
const hostBadge = document.getElementById('host-badge');
const hostHint = document.getElementById('host-hint');
const squadSlotsEl = document.getElementById('squad-slots');
const squadCountEl = document.getElementById('squad-count');
const roomFullBanner = document.getElementById('room-full-banner');
const btnJoin = document.getElementById('btn-join');

// HUD & Overlays
const hpFill = document.getElementById('hp-fill');
const hpText = document.getElementById('hp-text');
const reloadBadge = document.getElementById('reload-badge');
const sectorLabel = document.getElementById('sector-label');
const waveLabel = document.getElementById('wave-label');
const enemiesLeft = document.getElementById('enemies-left');
const weaponNameHud = document.getElementById('weapon-name-hud');
const ammoCounter = document.getElementById('ammo-counter');
const centerBanner = document.getElementById('center-banner');
const doorPrompt = document.getElementById('door-prompt');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverBox = document.querySelector('.gameover-box');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverStats = document.getElementById('gameover-stats');
const scoreboardList = document.getElementById('scoreboard-list');
const btnRestart = document.getElementById('btn-restart');
const btnMute = document.getElementById('btn-mute');
const btnFullscreen = document.getElementById('btn-fullscreen');

// Estado local
let myId = null;
let isHost = false;
let joined = false;
let serverState = {
  map: 'rain_ruins',
  mapName: 'SETOR 01 // RUÍNAS SOB TEMPESTADE',
  doorX: 411,
  doorUnlocked: false,
  modifier: 'NORMAL',
  order: 1,
  totalOrders: 6,
  waveStatus: 'waiting',
  players: [],
  enemies: [],
  pickups: []
};

let bloodStains = [];
let particles = [];
let tracers = [];
let muzzleFlashes = [];
let slashArcs = [];
let dustPuffs = [];
let shakeAmount = 0;
let lightningFlash = 0;
let bannerTimeout = null;
let lastWeaponDrawn = null;

// Chuva pixel-art
const raindrops = Array.from({ length: 155 }, () => ({
  x: Math.random() * 600,
  y: Math.random() * 310,
  len: 8 + Math.floor(Math.random() * 10),
  speed: 245 + Math.random() * 95
}));

// Controles
const keys = { up: false, down: false, left: false, right: false };
let mouseX = 320;
let mouseY = 225;
let mouseDown = false;
let currentAimAngle = 0;
let lastAutoFire = 0;

// ============================================================================
// MOTOR DE ÁUDIO PROCEDURAL NOIR (WEB AUDIO API)
// ============================================================================
class NoirAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.rainGain = null;
    this.heartbeatTimer = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 650;
    filter.Q.value = 0.7;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.025;

    noise.connect(filter);
    filter.connect(this.rainGain);
    this.rainGain.connect(this.ctx.destination);
    noise.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.rainGain) this.rainGain.gain.value = this.muted ? 0 : 0.025;
    return this.muted;
  }

  playShot(weapon) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const duration = weapon === 'shotgun' || weapon === 'sniper' ? 0.32 : weapon === 'smg' ? 0.11 : 0.16;

    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.22));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(weapon === 'sniper' ? 2400 : 1400, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(weapon === 'smg' ? 0.22 : 0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  playBladeSlash() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.14);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playDoorUnlock() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    [330, 440, 660].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.14, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.23);
    });
  }

  playAlertSting() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.05);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playEmptyClick() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  playReload() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    [0, 0.2].forEach((offset, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i === 0 ? 640 : 1080, now + offset);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.07);
    });
  }

  playGrowl(type) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(type === 'crawler' ? 340 : 88, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.28);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.29);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  updateHeartbeat(hp, dt) {
    if (!this.ctx || this.muted || hp <= 0 || hp > 35) return;
    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = 0.7;
      const now = this.ctx.currentTime;
      [0, 0.15].forEach((delay, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(idx === 0 ? 60 : 48, now + delay);
        gain.gain.setValueAtTime(0.22, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.13);
      });
    }
  }
}

const sound = new NoirAudio();

// ============================================================================
// TELA CHEIA (FULLSCREEN API)
// ============================================================================
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

btnFullscreen.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  btnFullscreen.textContent = document.fullscreenElement ? 'SAIR TELA CHEIA' : 'TELA CHEIA';
});

// ============================================================================
// PIXEL-ART: ARMAS & PERSONAGENS
// ============================================================================
const WEAPON_LABELS = {
  pistol: 'PISTOLA 9MM',
  shotgun: 'ESCOPETA',
  smg: 'SUBMETRALHADORA',
  sniper: 'RIFLE PRECISÃO',
  katana: 'KATANA'
};

function getSelectedWeapon() {
  for (const r of weaponRadios) {
    if (r.checked) return r.value;
  }
  return 'pistol';
}

function drawPixelWeapon(targetCtx, weapon, x, y, scale = 1) {
  targetCtx.save();
  targetCtx.translate(Math.round(x), Math.round(y));
  targetCtx.scale(scale, scale);

  if (weapon === 'katana') {
    targetCtx.fillStyle = '#222222';
    targetCtx.fillRect(-3, -1, 5, 2);
    targetCtx.fillStyle = '#ff1e1e';
    targetCtx.fillRect(2, -2, 1, 4);
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(3, -1, 20, 1.5);
  } else if (weapon === 'shotgun') {
    targetCtx.fillStyle = '#555555';
    targetCtx.fillRect(-5, -1, 6, 3);
    targetCtx.fillStyle = '#b0b0b0';
    targetCtx.fillRect(1, -2, 13, 2);
    targetCtx.fillStyle = '#777777';
    targetCtx.fillRect(5, 0, 5, 1.5);
  } else if (weapon === 'smg') {
    targetCtx.fillStyle = '#7a7a7a';
    targetCtx.fillRect(-3, -2, 10, 3);
    targetCtx.fillStyle = '#cccccc';
    targetCtx.fillRect(7, -1, 4, 1.5);
    targetCtx.fillStyle = '#444444';
    targetCtx.fillRect(2, 1, 2, 5);
  } else if (weapon === 'sniper') {
    targetCtx.fillStyle = '#4a4a4a';
    targetCtx.fillRect(-6, -1, 7, 3);
    targetCtx.fillStyle = '#d4d4d4';
    targetCtx.fillRect(1, -2, 19, 2);
    targetCtx.fillStyle = '#ff1e1e';
    targetCtx.fillRect(3, -4, 6, 1.5);
  } else {
    targetCtx.fillStyle = '#666666';
    targetCtx.fillRect(-2, -1, 3, 4);
    targetCtx.fillStyle = '#e0e0e0';
    targetCtx.fillRect(-2, -3, 8, 2.5);
  }

  targetCtx.restore();
}

function drawNoirSurvivor(targetCtx, p, time, isPreview = false) {
  targetCtx.save();
  targetCtx.translate(Math.round(p.x), Math.round(p.y));

  if (p.hp <= 0) {
    targetCtx.fillStyle = '#262626';
    targetCtx.fillRect(-10, -4, 18, 4);
    targetCtx.fillStyle = '#888888';
    targetCtx.fillRect(8, -4, 4, 4);
    targetCtx.font = '6px monospace';
    targetCtx.textAlign = 'center';
    targetCtx.fillStyle = '#ff3b3b';
    targetCtx.fillText('ABATIDO', 0, -9);
    targetCtx.restore();
    return;
  }

  const stride = p.moving ? Math.round(Math.sin(time * 16) * 3) : 0;
  const breath = !p.moving ? Math.round(Math.sin(time * 3)) : 0;

  targetCtx.save();
  targetCtx.scale(p.facing, 1);

  // Pernas
  targetCtx.fillStyle = '#181818';
  targetCtx.fillRect(-3 + stride, -11, 2, 11);
  targetCtx.fillRect(1 - stride, -11, 2, 11);

  // Traje
  if (p.outfit === 'coat') {
    targetCtx.fillStyle = '#0c0c0c';
    targetCtx.beginPath();
    targetCtx.moveTo(-4, -22 + breath);
    targetCtx.lineTo(4, -22 + breath);
    targetCtx.lineTo(6 - stride * 0.5, -3);
    targetCtx.lineTo(-6 - stride * 0.5, -3);
    targetCtx.closePath();
    targetCtx.fill();
    targetCtx.strokeStyle = '#333333';
    targetCtx.lineWidth = 1;
    targetCtx.stroke();
  } else if (p.outfit === 'hood') {
    targetCtx.fillStyle = '#090909';
    targetCtx.beginPath();
    targetCtx.moveTo(-3, -27 + breath);
    targetCtx.lineTo(3, -27 + breath);
    targetCtx.lineTo(7, -2);
    targetCtx.lineTo(-6, -2);
    targetCtx.closePath();
    targetCtx.fill();
  } else if (p.outfit === 'lab') {
    targetCtx.fillStyle = '#d8d8d8';
    targetCtx.fillRect(-4, -22 + breath, 8, 13);
  } else {
    targetCtx.fillStyle = '#5e5e5e';
    targetCtx.fillRect(-4, -22 + breath, 8, 12);
  }

  if (p.outfit !== 'hood') {
    targetCtx.fillStyle = '#e6e6e6';
    targetCtx.fillRect(-3, -28 + breath, 6, 6);
    targetCtx.fillStyle = '#1c1c1c';
    targetCtx.fillRect(-3, -29 + breath, 6, 2);
  }

  targetCtx.fillStyle = p.eyeColor || '#ffffff';
  targetCtx.fillRect(1, -26 + breath, 2, 1.5);

  targetCtx.restore();

  // Braço e Arma
  targetCtx.save();
  const recoilOffset = (p.recoil || 0) * -2.5;
  targetCtx.translate(Math.cos(p.aimAngle) * recoilOffset, -17 + breath + Math.sin(p.aimAngle) * recoilOffset);

  if (p.weapon === 'katana') {
    targetCtx.rotate(p.aimAngle - 0.55);
    drawPixelWeapon(targetCtx, 'katana', 3, 0, 1);
  } else {
    targetCtx.rotate(p.aimAngle);
    if (Math.cos(p.aimAngle) < 0) targetCtx.scale(1, -1);
    targetCtx.fillStyle = '#8c8c8c';
    targetCtx.fillRect(0, -1, 7, 2);
    drawPixelWeapon(targetCtx, p.weapon, 7, 0, 1);
  }
  targetCtx.restore();

  if (!isPreview) {
    targetCtx.font = '7px monospace';
    targetCtx.textAlign = 'center';
    targetCtx.fillStyle = p.id === myId ? '#ffffff' : '#888888';
    targetCtx.fillText(p.name, 0, -34);
  }

  targetCtx.restore();
}

function updateWeaponHudIcon(weapon) {
  if (lastWeaponDrawn === weapon) return;
  lastWeaponDrawn = weapon;
  weaponNameHud.textContent = WEAPON_LABELS[weapon] || 'ARMA';

  wHudCtx.clearRect(0, 0, weaponHudCanvas.width, weaponHudCanvas.height);
  wHudCtx.save();
  wHudCtx.translate(22, 15);
  wHudCtx.rotate(-0.2);
  drawPixelWeapon(wHudCtx, weapon, 0, 0, 2.2);
  wHudCtx.restore();
}

// ============================================================================
// LOBBY: ESQUADRÃO DE 4 JOGADORES E CONFIGURAÇÕES DO HOST
// ============================================================================
function renderSquadSlots(players, maxPlayers) {
  squadCountEl.textContent = `${players.length} / ${maxPlayers} JOGADORES`;
  squadSlotsEl.innerHTML = '';

  for (let i = 0; i < maxPlayers; i++) {
    const p = players[i];
    const slot = document.createElement('div');

    if (p) {
      slot.className = `squad-slot ${p.id === myId ? 'me' : ''}`;
      const statusText = p.joined ? 'EM COMBATE' : 'NO LOBBY';
      const statusClass = p.joined ? 'ready' : '';
      const rolePrefix = p.isHost ? '★ ' : '';

      slot.innerHTML = `
        <div class="slot-top">
          <span class="slot-name">${rolePrefix}${escapeHtml(p.name)}</span>
          <span class="slot-eye" style="background:${p.eyeColor}"></span>
        </div>
        <div class="slot-meta">
          <span>${WEAPON_LABELS[p.weapon] || p.weapon}</span>
          <span class="slot-status ${statusClass}">${statusText}</span>
        </div>
      `;
    } else {
      slot.className = 'squad-slot empty';
      slot.textContent = '[ VAGA LIVRE ]';
    }

    squadSlotsEl.appendChild(slot);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function sendLobbyPreviewUpdate() {
  socket.emit('updateLobbyProfile', {
    name: nameInput.value,
    outfit: outfitSelect.value,
    eyeColor: eyeSelect.value,
    weapon: getSelectedWeapon()
  });
}

[nameInput, outfitSelect, eyeSelect, ...weaponRadios].forEach((el) => {
  el.addEventListener('input', sendLobbyPreviewUpdate);
  el.addEventListener('change', sendLobbyPreviewUpdate);
});

function applyHostPermissions(hostStatus) {
  isHost = hostStatus;
  [
    mapSelect,
    totalOrdersSelect,
    walkerCheck,
    crawlerCheck,
    sprinterCheck,
    reaperCheck,
    countSelect,
    speedSelect
  ].forEach((el) => {
    el.disabled = !isHost;
  });

  if (isHost) {
    hostBadge.textContent = 'LÍDER DA SALA';
    hostBadge.classList.remove('guest');
    hostHint.textContent = 'Você controla a meta de Ordens e o cenário inicial.';
  } else {
    hostBadge.textContent = 'CONVIDADO';
    hostBadge.classList.add('guest');
    hostHint.textContent = 'Aguardando configuração do líder da sala.';
  }
}

function emitSettingsChange() {
  if (!isHost) return;
  if (!walkerCheck.checked && !crawlerCheck.checked && !sprinterCheck.checked && !reaperCheck.checked) {
    walkerCheck.checked = true;
  }
  socket.emit('updateSettings', {
    map: mapSelect.value,
    totalOrders: parseInt(totalOrdersSelect.value, 10),
    enableWalker: walkerCheck.checked,
    enableCrawler: crawlerCheck.checked,
    enableSprinter: sprinterCheck.checked,
    enableReaper: reaperCheck.checked,
    countMultiplier: parseFloat(countSelect.value),
    speedMultiplier: parseFloat(speedSelect.value)
  });
}

[
  mapSelect,
  totalOrdersSelect,
  walkerCheck,
  crawlerCheck,
  sprinterCheck,
  reaperCheck,
  countSelect,
  speedSelect
].forEach((el) => {
  el.addEventListener('change', emitSettingsChange);
});

btnJoin.addEventListener('click', () => {
  sound.init();
  joined = true;
  lobbyOverlay.classList.add('hidden');

  socket.emit('joinGame', {
    name: nameInput.value,
    outfit: outfitSelect.value,
    eyeColor: eyeSelect.value,
    weapon: getSelectedWeapon()
  });
});

btnRestart.addEventListener('click', () => {
  gameoverOverlay.classList.add('hidden');
  socket.emit('restartGame');
});

btnMute.addEventListener('click', () => {
  sound.init();
  const muted = sound.toggleMute();
  btnMute.textContent = muted ? 'SOM: OFF' : 'SOM: ON';
});

// ============================================================================
// EVENTOS SOCKET.IO
// ============================================================================
socket.on('roomFull', () => {
  roomFullBanner.classList.remove('hidden');
  btnJoin.disabled = true;
  btnJoin.textContent = 'SALA LOTADA (4/4)';
});

socket.on('init', (data) => {
  myId = data.id;
  bloodStains = data.bloodStains || [];
  applyHostPermissions(data.isHost);
  syncSettingsUI(data.settings);
  sendLobbyPreviewUpdate();
});

socket.on('lobbyUpdated', (data) => {
  renderSquadSlots(data.players, data.maxPlayers);
});

socket.on('hostAssigned', (status) => applyHostPermissions(status));
socket.on('settingsUpdated', (s) => syncSettingsUI(s));

function syncSettingsUI(s) {
  if (!s) return;
  mapSelect.value = s.map || 'rain_ruins';
  totalOrdersSelect.value = String(s.totalOrders || 6);
  walkerCheck.checked = s.enableWalker;
  crawlerCheck.checked = s.enableCrawler;
  sprinterCheck.checked = s.enableSprinter;
  reaperCheck.checked = s.enableReaper;
  countSelect.value = String(s.countMultiplier);
  speedSelect.value = String(s.speedMultiplier);
}

socket.on('state', (state) => {
  serverState = state;
  updateHud();
});

socket.on('orderStarted', (data) => {
  const modText =
    data.modifier === 'BLACKOUT'
      ? ' // APAGÃO ELÉTRICO'
      : data.modifier === 'BLOOD_ALERT'
      ? ' // ALERTA DE HORDA ELITE'
      : '';
  showBanner(`ORDEM ${String(data.order).padStart(2, '0')} DE ${String(data.totalOrders).padStart(2, '0')}${modText}`);
});

socket.on('doorUnlocked', (data) => {
  sound.playDoorUnlock();
  showBanner(`ORDEM ${String(data.completedOrder).padStart(2, '0')} CONCLUÍDA — PORTA [!] DESTRANCADA`);
});

socket.on('mapChanged', (data) => {
  bloodStains = [];
  particles = [];
  dustPuffs = [];
  lightningFlash = 0.25;
  showBanner(`${data.triggeredBy.toUpperCase()} ABRIU A PORTA → ${data.mapName}`);
});

socket.on('victory', (data) => {
  gameoverBox.classList.add('victory');
  gameoverTitle.textContent = 'OPERAÇÃO CONCLUÍDA';
  gameoverStats.textContent = `Todas as ${data.totalOrders} Ordens foram purificadas com sucesso!`;
  renderScoreboard(data.scoreboard);
  gameoverOverlay.classList.remove('hidden');
});

socket.on('gameOver', (data) => {
  gameoverBox.classList.remove('victory');
  gameoverTitle.textContent = 'SINAL PERDIDO';
  gameoverStats.textContent = `O esquadrão caiu na Ordem ${String(data.order).padStart(2, '0')} de ${String(data.totalOrders).padStart(2, '0')}.`;
  renderScoreboard(data.scoreboard);
  gameoverOverlay.classList.remove('hidden');
});

function renderScoreboard(list) {
  if (!list || list.length === 0) {
    scoreboardList.innerHTML = '';
    return;
  }
  const sorted = [...list].sort((a, b) => b.kills - a.kills);
  scoreboardList.innerHTML = sorted
    .map(
      (item, idx) => `
      <div class="score-row">
        <span>#${idx + 1} ${escapeHtml(item.name)}</span>
        <span>${item.kills} ABATES</span>
      </div>`
    )
    .join('');
}

socket.on('gameRestarted', () => {
  bloodStains = [];
  particles = [];
  dustPuffs = [];
  gameoverOverlay.classList.add('hidden');
  showBanner('NOVA OPERAÇÃO INICIADA');
});

socket.on('emptyClick', () => sound.playEmptyClick());
socket.on('enemyAlert', () => sound.playAlertSting());

socket.on('playerReloading', (data) => {
  if (data.playerId === myId) sound.playReload();
});

socket.on('shotFired', (data) => {
  sound.playShot(data.weapon);
  if (data.playerId === myId) {
    shakeAmount = data.weapon === 'shotgun' || data.weapon === 'sniper' ? 5 : 2;
  }
  muzzleFlashes.push({ x: data.x, y: data.y, life: 0.06 });

  for (const r of data.rays) {
    tracers.push({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, life: 0.07 });
  }
  for (const h of data.hits) {
    spawnBloodParticles(h.x, h.y, 9);
  }
});

socket.on('meleeUsed', (data) => {
  sound.playBladeSlash();
  slashArcs.push({
    x: data.x,
    y: data.y - 14,
    angle: data.aimAngle,
    isBlade: data.isBlade,
    life: 0.14
  });
  for (const h of data.hits) {
    spawnBloodParticles(h.x, h.y, 12);
    sound.playGrowl(h.type);
  }
});

socket.on('enemyDied', (data) => {
  sound.playGrowl(data.type);
  bloodStains.push({
    x: Math.round(data.x),
    y: Math.round(data.y),
    w: 12 + Math.floor(Math.random() * 10),
    h: 3
  });
  if (bloodStains.length > 140) bloodStains.shift();
  spawnBloodParticles(data.x, data.y - 10, 18);
});

socket.on('playerDamaged', (data) => {
  spawnBloodParticles(data.x, data.y - 14, 12);
  if (data.playerId === myId) {
    shakeAmount = 6;
    sound.playGrowl(data.enemyType);
  }
});

function showBanner(text) {
  centerBanner.textContent = text;
  centerBanner.classList.remove('hidden');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => centerBanner.classList.add('hidden'), 3000);
}

function spawnBloodParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 25 + Math.random() * 95;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30,
      floorY: y + 10 + Math.random() * 14,
      life: 0.5 + Math.random() * 0.35
    });
  }
}

// ============================================================================
// CONTROLES DE TECLADO E MOUSE
// ============================================================================
function sendInput() {
  if (!joined) return;
  socket.emit('input', { inputs: keys, aimAngle: currentAimAngle });
}

window.addEventListener('keydown', (e) => {
  if (!joined) return;
  let changed = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') { if (!keys.up) { keys.up = true; changed = true; } }
  if (e.code === 'KeyS' || e.code === 'ArrowDown') { if (!keys.down) { keys.down = true; changed = true; } }
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') { if (!keys.left) { keys.left = true; changed = true; } }
  if (e.code === 'KeyD' || e.code === 'ArrowRight') { if (!keys.right) { keys.right = true; changed = true; } }

  if (e.code === 'KeyR') socket.emit('reload');
  if (e.code === 'KeyF') socket.emit('melee', currentAimAngle);
  if (e.code === 'KeyE') socket.emit('interactDoor');
  if (changed) sendInput();
});

window.addEventListener('keyup', (e) => {
  if (!joined) return;
  let changed = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') { keys.up = false; changed = true; }
  if (e.code === 'KeyS' || e.code === 'ArrowDown') { keys.down = false; changed = true; }
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') { keys.left = false; changed = true; }
  if (e.code === 'KeyD' || e.code === 'ArrowRight') { keys.right = false; changed = true; }
  if (changed) sendInput();
});

gameCanvas.addEventListener('mousemove', (e) => {
  const rect = gameCanvas.getBoundingClientRect();
  mouseX = ((e.clientX - rect.left) / rect.width) * gameCanvas.width;
  mouseY = ((e.clientY - rect.top) / rect.height) * gameCanvas.height;

  const me = serverState.players.find((p) => p.id === myId);
  if (me && me.hp > 0) {
    currentAimAngle = Math.atan2(mouseY - (me.y - 16), mouseX - me.x);
    sendInput();
  }
});

gameCanvas.addEventListener('mousedown', (e) => {
  if (!joined || e.button !== 0) return;
  sound.init();
  mouseDown = true;
  triggerPrimaryAction();
});

window.addEventListener('mouseup', () => {
  mouseDown = false;
});

function triggerPrimaryAction() {
  const me = serverState.players.find((p) => p.id === myId);
  if (me && me.hp > 0) {
    currentAimAngle = Math.atan2(mouseY - (me.y - 16), mouseX - me.x);
    socket.emit('shoot', currentAimAngle);
  }
}

function updateHud() {
  sectorLabel.textContent = serverState.mapName || 'SETOR 01';
  waveLabel.textContent = `ORDEM ${String(serverState.order).padStart(2, '0')} / ${String(serverState.totalOrders).padStart(2, '0')}`;

  if (serverState.doorUnlocked) {
    enemiesLeft.textContent = 'SETOR LIMPO — PORTA ABERTA';
  } else {
    enemiesLeft.textContent = `${String(serverState.enemies.length).padStart(2, '0')} AMEAÇAS RESTANTES`;
  }

  const me = serverState.players.find((p) => p.id === myId);
  if (!me) return;

  const hpPct = Math.max(0, Math.round((me.hp / me.maxHp) * 100));
  hpFill.style.width = `${hpPct}%`;
  hpFill.style.background = hpPct > 35 ? '#e6e6e6' : '#ff1e1e';
  hpText.textContent = me.hp > 0 ? `${hpPct}%` : 'ABATIDO';

  reloadBadge.classList.toggle('hidden', !me.reloading);
  updateWeaponHudIcon(me.weapon);
  ammoCounter.textContent = me.weapon === 'katana' ? '∞ | LÂMINA' : `${me.ammo} | ${me.reserve}`;

  // Exibe prompt de interação [E] se a porta estiver destrancada e o jogador estiver próximo
  const nearDoor =
    serverState.doorUnlocked &&
    me.hp > 0 &&
    Math.abs(me.x - serverState.doorX) <= 36;
  doorPrompt.classList.toggle('hidden', !nearDoor);
}

// ============================================================================
// RENDERIZAÇÃO DOS 3 MAPAS + PORTA INTERATIVA DINÂMICA
// ============================================================================
function drawPixelClouds(time) {
  ctx.fillStyle = '#1b1b1b';
  const drift = (time * 4) % 550;
  for (let i = -1; i <= 1; i++) {
    const baseX = i * 280 + drift;
    ctx.fillRect(baseX + 40, 22, 95, 18);
    ctx.fillRect(baseX + 58, 12, 56, 36);
    ctx.fillRect(baseX + 160, 44, 110, 22);
    ctx.fillRect(baseX + 180, 34, 65, 40);
  }
}

function drawDoorIndicator(doorX, doorTopY, time) {
  if (serverState.doorUnlocked) {
    // Porta destrancada: brilho pulsante e balão [!] branco/vermelho
    const bob = Math.round(Math.sin(time * 8) * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(doorX - 16, doorTopY + 1, 32, 66);
    drawAlertBubble(doorX, doorTopY - 14 + bob, true);
  } else {
    // Porta trancada durante a Ordem: cadeado/balão escuro [X]
    drawLockedBubble(doorX, doorTopY - 14);
  }
}

function drawMapEnvironment(mapName, time) {
  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(0, 0, 550, 310);

  if (mapName === 'subway') {
    // --- MAPA 2: ESTAÇÃO SUBTERRÂNEA ---
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 42, 550, 174);

    ctx.fillStyle = '#1c1c1c';
    for (let y = 55; y < 210; y += 18) {
      ctx.fillRect(0, y, 550, 1);
    }

    for (let x = 75; x < 450; x += 130) {
      ctx.fillStyle = '#090909';
      ctx.fillRect(x, 42, 18, 174);
      ctx.fillStyle = '#242424';
      ctx.fillRect(x + 2, 42, 4, 174);
    }

    // Luminárias fluorescentes (piscam mais no modo BLACKOUT)
    const flickerThreshold = serverState.modifier === 'BLACKOUT' ? 0.2 : -0.85;
    [140, 275, 410].forEach((lx, idx) => {
      const on = Math.sin(time * 25 + idx * 7) > flickerThreshold;
      ctx.fillStyle = '#222';
      ctx.fillRect(lx - 24, 42, 48, 4);
      if (on) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(lx - 20, 45, 40, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(lx - 20, 47);
        ctx.lineTo(lx + 20, 47);
        ctx.lineTo(lx + 65, 220);
        ctx.lineTo(lx - 65, 220);
        ctx.fill();
      }
    });

    // Porta de acesso ao próximo setor (X = 486)
    ctx.fillStyle = '#333333';
    ctx.fillRect(469, 148, 34, 68);
    ctx.strokeStyle = serverState.doorUnlocked ? '#ffffff' : '#555555';
    ctx.lineWidth = 1;
    ctx.strokeRect(470.5, 149.5, 31, 65);
    drawDoorIndicator(486, 148, time);
  } else if (mapName === 'asylum') {
    // --- MAPA 3: ALA PSIQUIÁTRICA ---
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 38, 550, 178);

    [110, 440].forEach((wx) => {
      ctx.fillStyle = lightningFlash > 0 ? '#cfcfcf' : '#222222';
      ctx.fillRect(wx - 28, 72, 56, 75);
      ctx.fillStyle = '#080808';
      for (let bx = wx - 22; bx <= wx + 22; bx += 11) {
        ctx.fillRect(bx, 72, 2, 75);
      }
    });

    // Porta dupla central (X = 275)
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(250, 148, 50, 68);
    ctx.fillStyle = '#2f2f2f';
    ctx.fillRect(252, 150, 22, 66);
    ctx.fillRect(276, 150, 22, 66);
    if (serverState.doorUnlocked) {
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(250.5, 148.5, 49, 67);
    }
    drawDoorIndicator(275, 148, time);
  } else {
    // --- MAPA 1: RUÍNAS SOB TEMPESTADE ---
    drawPixelClouds(time);

    ctx.fillStyle = '#151515';
    ctx.fillRect(140, 135, 95, 81);
    ctx.fillRect(310, 150, 80, 66);

    // Edifício esquerdo
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 74, 112, 142);
    ctx.fillStyle = '#262626';
    ctx.fillRect(24, 152, 42, 64);
    ctx.fillStyle = '#030303';
    ctx.fillRect(0, 64, 116, 12);
    ctx.fillRect(104, 64, 12, 65);
    ctx.fillStyle = '#8c8c8c';
    ctx.fillRect(92, 76, 3, 140);

    // Edifício direito + Porta metálica (X = 411)
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(388, 74, 162, 142);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(465, 115, 55, 65);
    ctx.fillRect(475, 125, 35, 45);
    ctx.fillStyle = '#030303';
    ctx.fillRect(384, 64, 166, 12);
    ctx.fillRect(384, 64, 12, 65);

    ctx.fillStyle = '#383838';
    ctx.fillRect(394, 148, 34, 68);
    ctx.strokeStyle = serverState.doorUnlocked ? '#ffffff' : '#666666';
    ctx.lineWidth = 1;
    ctx.strokeRect(395.5, 149.5, 31, 65);

    drawDoorIndicator(411, 148, time);

    // Laje inclinada
    ctx.save();
    ctx.translate(458, 182);
    ctx.rotate(-0.34);
    ctx.fillStyle = '#333333';
    ctx.fillRect(-7, -34, 14, 68);
    ctx.restore();

    // Vergalhões
    ctx.fillStyle = '#030303';
    ctx.fillRect(116, 70, 52, 2);
    ctx.fillRect(116, 82, 38, 1);
    ctx.fillRect(138, 64, 2, 24);
    ctx.fillRect(334, 70, 50, 2);
    ctx.fillRect(352, 63, 2, 20);
  }

  // Piso caminhável escuro
  ctx.fillStyle = '#151515';
  ctx.fillRect(0, 215, 550, 37);
  ctx.fillStyle = '#292929';
  ctx.fillRect(0, 215, 550, 1);

  // Corte subterrâneo preto sólido
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 252, 550, 58);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 252, 550, 2);
}

function drawAlertBubble(x, y, highlightRed = false) {
  const bx = Math.round(x - 8);
  const by = Math.round(y - 7);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx, by, 16, 12);
  ctx.fillRect(bx + 7, by + 12, 2, 2);
  ctx.fillStyle = highlightRed ? '#ff1e1e' : '#050505';
  ctx.fillRect(bx + 7, by + 2, 2, 5);
  ctx.fillRect(bx + 7, by + 9, 2, 2);
}

function drawLockedBubble(x, y) {
  const bx = Math.round(x - 8);
  const by = Math.round(y - 7);
  ctx.fillStyle = '#262626';
  ctx.fillRect(bx, by, 16, 12);
  ctx.fillRect(bx + 7, by + 12, 2, 2);
  ctx.fillStyle = '#777777';
  ctx.fillRect(bx + 6, by + 4, 4, 5);
}

// ============================================================================
// RENDERIZAÇÃO DOS MONSTROS (COM AURA ELITE NAS ORDENS AVANÇADAS)
// ============================================================================
function drawNoirEnemy(e, time) {
  ctx.save();
  ctx.translate(Math.round(e.x), Math.round(e.y));

  if (e.isElite) {
    ctx.scale(1.18, 1.18);
    // Sombra vermelha sob inimigos Elite
    ctx.fillStyle = 'rgba(255, 30, 30, 0.28)';
    ctx.fillRect(-8, -2, 16, 3);
  }

  const flash = e.hitFlash > 0;
  const bodyGray = flash ? '#ffffff' : e.isElite ? '#8a3232' : '#6e6e6e';
  const darkGray = flash ? '#ffffff' : '#262626';

  if (e.type === 'crawler') {
    const crawl = Math.round(Math.sin(time * 24 + e.id) * 2);
    ctx.scale(e.facing, 1);

    ctx.fillStyle = darkGray;
    ctx.fillRect(-9 + crawl, -7, 2, 7);
    ctx.fillRect(4 - crawl, -8, 2, 8);
    ctx.fillRect(7 + crawl, -7, 2, 7);

    ctx.fillStyle = bodyGray;
    ctx.fillRect(-8, -11, 13, 5);

    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(4, -13, 5, 5);
    ctx.fillStyle = '#ff1e1e';
    ctx.fillRect(7, -11, 2, 2);
  } else if (e.type === 'sprinter') {
    const run = Math.round(Math.sin(time * 26 + e.id) * 4);
    ctx.scale(e.facing, 1);

    ctx.strokeStyle = darkGray;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -12);
    ctx.lineTo(-8 - run, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(1, -12);
    ctx.lineTo(6 + run, 0);
    ctx.stroke();

    ctx.save();
    ctx.translate(0, -12);
    ctx.rotate(0.45);
    ctx.fillStyle = bodyGray;
    ctx.fillRect(-3, -11, 6, 11);

    ctx.fillStyle = '#cccccc';
    ctx.fillRect(-11, -9, 9, 2);
    ctx.fillRect(-10, -6, 8, 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -16, 6, 5);
    ctx.fillStyle = '#ff1e1e';
    ctx.fillRect(3, -15, 2, 2);
    ctx.restore();
  } else if (e.type === 'reaper') {
    const hover = Math.round(Math.sin(time * 6 + e.id));
    ctx.scale(e.facing, 1);

    ctx.fillStyle = flash ? '#ffffff' : e.isElite ? '#2b0808' : '#080808';
    ctx.beginPath();
    ctx.moveTo(-4, -31 + hover);
    ctx.lineTo(4, -31 + hover);
    ctx.lineTo(9, 0);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = e.isElite ? '#ff1e1e' : '#333333';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ff1e1e';
    ctx.fillRect(1, -26 + hover, 3, 2);
  } else {
    const shamble = Math.round(Math.sin(time * 9 + e.id) * 2);
    ctx.scale(e.facing, 1);

    ctx.fillStyle = darkGray;
    ctx.fillRect(-3 + shamble, -12, 2, 12);
    ctx.fillRect(1 - shamble, -12, 2, 12);

    ctx.fillStyle = bodyGray;
    ctx.fillRect(-3, -22, 6, 10);

    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(3, -20, 8, 2);

    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-2, -28, 6, 6);
    ctx.fillStyle = '#ff1e1e';
    ctx.fillRect(2, -26, 2, 2);
  }

  if (e.alertTimer > 0) {
    drawAlertBubble(0, e.type === 'crawler' ? -22 : -38, false);
  }

  if (e.hp < e.maxHp) {
    const w = 16;
    ctx.fillStyle = '#050505';
    ctx.fillRect(-w / 2, -34, w, 2);
    ctx.fillStyle = '#ff1e1e';
    ctx.fillRect(-w / 2, -34, Math.max(1, w * (e.hp / e.maxHp)), 2);
  }

  ctx.restore();
}

function drawPickups(time) {
  const bob = Math.round(Math.sin(time * 5));
  for (const item of serverState.pickups) {
    ctx.save();
    ctx.translate(Math.round(item.x), Math.round(item.y) + bob);
    if (item.type === 'medkit') {
      ctx.fillStyle = '#e6e6e6';
      ctx.fillRect(-5, -7, 10, 7);
      ctx.fillStyle = '#ff1e1e';
      ctx.fillRect(-1, -6, 2, 5);
      ctx.fillRect(-3, -4, 6, 1.5);
    } else {
      ctx.fillStyle = '#555555';
      ctx.fillRect(-5, -6, 10, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, -4, 6, 2);
    }
    ctx.restore();
  }
}

function updateAndDrawRain(targetCtx, width, height, floorMinY, floorMaxY, dt, active) {
  if (!active) return;

  targetCtx.strokeStyle = 'rgba(200, 200, 200, 0.24)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();

  for (const r of raindrops) {
    r.x -= r.speed * 0.22 * dt;
    r.y += r.speed * dt;

    if (r.y > floorMaxY) {
      if (Math.random() < 0.35) {
        dustPuffs.push({
          x: r.x,
          y: floorMinY + Math.random() * (floorMaxY - floorMinY),
          vx: (Math.random() - 0.5) * 18,
          vy: -12 - Math.random() * 14,
          life: 0.18
        });
      }
      r.y = -10;
      r.x = Math.random() * (width + 60);
    }

    targetCtx.moveTo(Math.round(r.x), Math.round(r.y));
    targetCtx.lineTo(Math.round(r.x - r.len * 0.22), Math.round(r.y + r.len));
  }
  targetCtx.stroke();
}

// ============================================================================
// LOOP PRINCIPAL DE RENDERIZAÇÃO
// ============================================================================
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const timeSec = now / 1000;

  if (!joined) {
    menuRainCanvas.width = 550;
    menuRainCanvas.height = 310;
    menuRainCtx.clearRect(0, 0, 550, 310);
    updateAndDrawRain(menuRainCtx, 550, 310, 220, 290, dt, true);

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCtx.fillStyle = '#0c0c0c';
    previewCtx.fillRect(0, 62, 120, 22);
    previewCtx.fillStyle = '#2a2a2a';
    previewCtx.fillRect(0, 62, 120, 1);

    drawNoirSurvivor(
      previewCtx,
      {
        x: 56,
        y: 62,
        outfit: outfitSelect.value,
        eyeColor: eyeSelect.value,
        weapon: getSelectedWeapon(),
        aimAngle: 0,
        facing: 1,
        moving: false,
        hp: 100
      },
      timeSec,
      true
    );
  }

  const me = serverState.players.find((p) => p.id === myId);
  if (joined && me && me.hp > 0) {
    sound.updateHeartbeat(me.hp, dt);
    currentAimAngle = Math.atan2(mouseY - (me.y - 16), mouseX - me.x);

    if (mouseDown && me.weapon === 'smg' && now - lastAutoFire > 100) {
      lastAutoFire = now;
      socket.emit('shoot', currentAimAngle);
    }

    if (me.moving && Math.random() < 0.35) {
      dustPuffs.push({
        x: me.x - me.facing * 4,
        y: me.y,
        vx: -me.facing * (10 + Math.random() * 14),
        vy: -8 - Math.random() * 10,
        life: 0.24
      });
    }
  }

  if (shakeAmount > 0) shakeAmount = Math.max(0, shakeAmount - dt * 24);
  if (lightningFlash > 0) lightningFlash = Math.max(0, lightningFlash - dt);
  if (serverState.map === 'asylum' && Math.random() < 0.004) lightningFlash = 0.14;

  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    muzzleFlashes[i].life -= dt;
    if (muzzleFlashes[i].life <= 0) muzzleFlashes.splice(i, 1);
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) tracers.splice(i, 1);
  }
  for (let i = slashArcs.length - 1; i >= 0; i--) {
    slashArcs[i].life -= dt;
    if (slashArcs[i].life <= 0) slashArcs.splice(i, 1);
  }
  for (let i = dustPuffs.length - 1; i >= 0; i--) {
    const d = dustPuffs[i];
    d.life -= dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vy += 65 * dt;
    if (d.life <= 0) dustPuffs.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    pt.vy += 190 * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    if (pt.y >= pt.floorY) {
      pt.y = pt.floorY;
      pt.vx *= 0.2;
      pt.vy = 0;
    }
    if (pt.life <= 0) particles.splice(i, 1);
  }

  // --- DESENHO DA ARENA ---
  ctx.save();
  if (shakeAmount > 0) {
    ctx.translate(Math.round((Math.random() - 0.5) * shakeAmount), Math.round((Math.random() - 0.5) * shakeAmount));
  }

  drawMapEnvironment(serverState.map, timeSec);

  ctx.fillStyle = '#9e1111';
  for (const st of bloodStains) {
    ctx.fillRect(st.x - Math.floor(st.w / 2), st.y - 1, st.w, st.h);
  }

  drawPickups(timeSec);

  const entities = [
    ...serverState.players.map((p) => ({ kind: 'player', y: p.y, data: p })),
    ...serverState.enemies.map((e) => ({ kind: 'enemy', y: e.y, data: e }))
  ];
  entities.sort((a, b) => a.y - b.y);

  for (const ent of entities) {
    if (ent.kind === 'player') drawNoirSurvivor(ctx, ent.data, timeSec, false);
    else drawNoirEnemy(ent.data, timeSec);
  }

  ctx.fillStyle = '#dcdcdc';
  for (const d of dustPuffs) {
    ctx.fillRect(Math.round(d.x), Math.round(d.y), 1.5, 1.5);
  }

  ctx.fillStyle = '#ff1e1e';
  for (const pt of particles) {
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
  }

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (const tr of tracers) {
    ctx.beginPath();
    ctx.moveTo(Math.round(tr.x1), Math.round(tr.y1));
    ctx.lineTo(Math.round(tr.x2), Math.round(tr.y2));
    ctx.stroke();
  }

  for (const sl of slashArcs) {
    ctx.strokeStyle = sl.isBlade ? '#ffffff' : '#888888';
    ctx.lineWidth = sl.isBlade ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(Math.round(sl.x), Math.round(sl.y), sl.isBlade ? 24 : 18, sl.angle - 0.85, sl.angle + 0.85);
    ctx.stroke();
  }

  updateAndDrawRain(ctx, 550, 310, 218, 250, dt, serverState.map === 'rain_ruins');

  // Efeitos dinâmicos por Ordem (Apagão ou Alerta Vermelho)
  if (serverState.modifier === 'BLACKOUT') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    ctx.fillRect(0, 0, 550, 252);
  } else if (serverState.modifier === 'BLOOD_ALERT') {
    ctx.fillStyle = 'rgba(180, 15, 15, 0.12)';
    ctx.fillRect(0, 0, 550, 252);
  }

  if (muzzleFlashes.length > 0 || lightningFlash > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, 0, 550, 252);
  }

  const vig = ctx.createRadialGradient(275, 155, 140, 275, 155, 320);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.68)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, 550, 310);

  ctx.restore();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);