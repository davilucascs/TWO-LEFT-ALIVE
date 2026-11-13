const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_ONLINE_PLAYERS = 4;

// Resolução lógica pixel-art 1:1
const WORLD = {
  width: 550,
  height: 310,
  minX: 24,
  maxX: 526,
  minY: 215,
  maxY: 252
};

// Mapas e posição da porta interativa [!]
const MAPS = {
  rain_ruins: {
    id: 'rain_ruins',
    name: 'SETOR 01 // RUÍNAS SOB TEMPESTADE',
    doorX: 411
  },
  subway: {
    id: 'subway',
    name: 'SETOR 02 // ESTAÇÃO SUBTERRÂNEA',
    doorX: 486
  },
  asylum: {
    id: 'asylum',
    name: 'SETOR 03 // ALA PSIQUIÁTRICA',
    doorX: 275
  }
};

const MAP_ORDER = ['rain_ruins', 'subway', 'asylum'];

// Arsenal completo (5 armas)
const WEAPONS = {
  pistol: {
    name: 'Pistola 9mm',
    clipSize: 12,
    initialReserve: 48,
    pellets: 1,
    spread: 0.03,
    damage: 38,
    range: 360,
    fireRate: 220,
    reloadTime: 950,
    pierce: false,
    isMelee: false
  },
  shotgun: {
    name: 'Escopeta',
    clipSize: 6,
    initialReserve: 24,
    pellets: 5,
    spread: 0.26,
    damage: 25,
    range: 225,
    fireRate: 750,
    reloadTime: 1450,
    pierce: false,
    isMelee: false
  },
  smg: {
    name: 'Submetralhadora',
    clipSize: 28,
    initialReserve: 112,
    pellets: 1,
    spread: 0.11,
    damage: 21,
    range: 295,
    fireRate: 95,
    reloadTime: 1200,
    pierce: false,
    isMelee: false
  },
  sniper: {
    name: 'Rifle Precisão',
    clipSize: 5,
    initialReserve: 20,
    pellets: 1,
    spread: 0.004,
    damage: 120,
    range: 530,
    fireRate: 900,
    reloadTime: 1650,
    pierce: true,
    isMelee: false
  },
  katana: {
    name: 'Lâmina Espectral',
    clipSize: 1,
    initialReserve: 0,
    pellets: 1,
    spread: 0,
    damage: 90,
    range: 56,
    fireRate: 330,
    reloadTime: 0,
    pierce: true,
    isMelee: true
  }
};

// Catálogo base de monstros
const ENEMY_TYPES = {
  walker: { hp: 75, speed: 44, damage: 14, radius: 10, detectRange: 220, attackCd: 1.05 },
  crawler: { hp: 52, speed: 84, damage: 11, radius: 9, detectRange: 255, attackCd: 0.8 },
  sprinter: { hp: 64, speed: 108, damage: 15, radius: 10, detectRange: 275, attackCd: 0.85 },
  reaper: { hp: 185, speed: 56, damage: 26, radius: 12, detectRange: 250, attackCd: 1.3 }
};

// Gerenciador de salas ('online' compartilha até 4 jogadores; 'solo_<id>' isola partidas solo)
const rooms = {};
const socketRoomMap = {};

function createRoom(roomId, isSolo = false) {
  return {
    id: roomId,
    isSolo,
    hostId: null,
    settings: {
      map: 'rain_ruins',
      totalOrders: 6,
      enableWalker: true,
      enableCrawler: true,
      enableSprinter: true,
      enableReaper: true,
      countMultiplier: 1,
      speedMultiplier: 1
    },
    currentMap: 'rain_ruins',
    dynamicModifier: 'NORMAL',
    players: {},
    enemies: [],
    pickups: [],
    bloodStains: [],
    order: 1,
    waveStatus: 'waiting', // 'waiting' | 'active' | 'door_open' | 'gameover' | 'victory'
    enemyIdCounter: 1,
    pickupIdCounter: 1
  };
}

rooms.online = createRoom('online', false);

function getRoomForSocket(socketId) {
  const roomId = socketRoomMap[socketId];
  return roomId ? rooms[roomId] : null;
}

function getAllConnectedInRoom(room) {
  return Object.values(room.players);
}

function getJoinedPlayers(room) {
  return getAllConnectedInRoom(room).filter((p) => p.joined);
}

function getAlivePlayers(room) {
  return getJoinedPlayers(room).filter((p) => p.hp > 0);
}

function broadcastOnlineLobby() {
  const room = rooms.online;
  if (!room) return;
  const list = getAllConnectedInRoom(room).map((p) => ({
    id: p.id,
    name: p.name,
    outfit: p.outfit,
    eyeColor: p.eyeColor,
    weapon: p.weapon,
    joined: p.joined,
    isHost: p.id === room.hostId
  }));

  io.to('online').emit('lobbyUpdated', {
    players: list,
    maxPlayers: MAX_ONLINE_PLAYERS
  });
}

function spawnOrder(room, orderNumber) {
  room.order = orderNumber;
  room.waveStatus = 'active';
  room.enemies = [];

  if (orderNumber === 1) {
    room.dynamicModifier = 'NORMAL';
  } else if (orderNumber % 3 === 0) {
    room.dynamicModifier = 'BLOOD_ALERT';
  } else if (orderNumber % 2 === 0) {
    room.dynamicModifier = 'BLACKOUT';
  } else {
    room.dynamicModifier = 'NORMAL';
  }

  const s = room.settings;
  const baseCount = Math.max(4, Math.round((4 + orderNumber * 2.5) * s.countMultiplier));

  const pool = [];
  if (s.enableWalker) pool.push('walker');
  if (s.enableCrawler) pool.push('crawler');
  if (s.enableSprinter) pool.push('sprinter');
  if (s.enableReaper) pool.push('reaper');
  if (pool.length === 0) pool.push('walker');

  const hpScale = 1 + (orderNumber - 1) * 0.42;
  const speedScale = 1 + (orderNumber - 1) * 0.12;
  const damageScale = 1 + (orderNumber - 1) * 0.25;

  for (let i = 0; i < baseCount; i++) {
    const type = pool[Math.floor(Math.random() * pool.length)];
    const cfg = ENEMY_TYPES[type];
    const isElite = orderNumber >= 2 && Math.random() < Math.min(0.55, (orderNumber - 1) * 0.14);

    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? WORLD.minX + Math.random() * 25 : WORLD.maxX - Math.random() * 25;
    const y = WORLD.minY + 4 + Math.random() * (WORLD.maxY - WORLD.minY - 8);

    const finalHp = Math.round(cfg.hp * hpScale * (isElite ? 1.55 : 1));
    const finalSpeed = cfg.speed * s.speedMultiplier * speedScale * (isElite ? 1.12 : 1);
    const finalDamage = Math.round(cfg.damage * damageScale * (isElite ? 1.3 : 1));

    room.enemies.push({
      id: room.enemyIdCounter++,
      type,
      isElite,
      x,
      y,
      hp: finalHp,
      maxHp: finalHp,
      speed: finalSpeed,
      damage: finalDamage,
      radius: isElite ? cfg.radius + 2 : cfg.radius,
      detectRange: cfg.detectRange + orderNumber * 18,
      attackCdMax: Math.max(0.45, cfg.attackCd - (orderNumber - 1) * 0.05),
      facing: fromLeft ? 1 : -1,
      state: 'patrol',
      alertTimer: 0,
      patrolTargetX: WORLD.minX + 60 + Math.random() * (WORLD.width - 120),
      patrolTargetY: WORLD.minY + 4 + Math.random() * (WORLD.maxY - WORLD.minY - 8),
      attackCooldown: 0,
      hitFlash: 0
    });
  }

  spawnPickup(room, 'ammo');
  spawnPickup(room, Math.random() < 0.65 ? 'medkit' : 'ammo');
  if (orderNumber >= 3) spawnPickup(room, 'ammo');

  io.to(room.id).emit('orderStarted', {
    order: room.order,
    totalOrders: room.settings.totalOrders,
    map: room.currentMap,
    mapName: MAPS[room.currentMap].name,
    modifier: room.dynamicModifier,
    enemyCount: room.enemies.length
  });
}

function spawnPickup(room, forcedType) {
  if (room.pickups.length >= 6) return;
  const type = forcedType || (Math.random() < 0.6 ? 'ammo' : 'medkit');
  room.pickups.push({
    id: room.pickupIdCounter++,
    type,
    x: WORLD.minX + 55 + Math.random() * (WORLD.width - 110),
    y: WORLD.minY + 6 + Math.random() * (WORLD.maxY - WORLD.minY - 12)
  });
}

function addBloodStain(room, x, y) {
  room.bloodStains.push({
    x: Math.round(x),
    y: Math.round(y),
    w: 10 + Math.floor(Math.random() * 12),
    h: 3 + Math.floor(Math.random() * 3)
  });
  if (room.bloodStains.length > 140) {
    room.bloodStains.shift();
  }
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function sanitizeSettings(raw) {
  const mapChoice = MAPS[raw?.map] ? raw.map : 'rain_ruins';
  const validOrders = [3, 6, 9].includes(Number(raw?.totalOrders)) ? Number(raw.totalOrders) : 6;
  const cleaned = {
    map: mapChoice,
    totalOrders: validOrders,
    enableWalker: Boolean(raw?.enableWalker ?? true),
    enableCrawler: Boolean(raw?.enableCrawler ?? true),
    enableSprinter: Boolean(raw?.enableSprinter ?? true),
    enableReaper: Boolean(raw?.enableReaper ?? true),
    countMultiplier: Number(raw?.countMultiplier) || 1,
    speedMultiplier: Number(raw?.speedMultiplier) || 1
  };
  if (!cleaned.enableWalker && !cleaned.enableCrawler && !cleaned.enableSprinter && !cleaned.enableReaper) {
    cleaned.enableWalker = true;
  }
  return cleaned;
}

function removePlayerFromCurrentRoom(socket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  socket.leave(room.id);
  delete room.players[socket.id];
  delete socketRoomMap[socket.id];

  if (room.isSolo) {
    delete rooms[room.id];
    return;
  }

  if (room.hostId === socket.id) {
    const remainingIds = Object.keys(room.players);
    room.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
    if (room.hostId) {
      io.to(room.hostId).emit('hostAssigned', true);
    }
  }

  if (getJoinedPlayers(room).length === 0) {
    room.waveStatus = 'waiting';
    room.enemies = [];
    room.pickups = [];
    room.order = 1;
  }

  broadcastOnlineLobby();
}

io.on('connection', (socket) => {
  const onlineRoom = rooms.online;

  if (!onlineRoom.hostId) {
    onlineRoom.hostId = socket.id;
  }

  const slotIndex = Object.keys(onlineRoom.players).length + 1;
  socketRoomMap[socket.id] = 'online';
  socket.join('online');

  onlineRoom.players[socket.id] = {
    id: socket.id,
    joined: false,
    name: `Agente 0${slotIndex}`,
    outfit: 'coat',
    eyeColor: '#ffffff',
    weapon: 'pistol',
    x: 160,
    y: 234,
    hp: 100,
    maxHp: 100,
    ammo: 12,
    reserve: 48,
    reloading: false,
    reloadStart: 0,
    reloadEnd: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashVx: 1,
    dashVy: 0,
    lastShot: 0,
    lastMelee: 0,
    recoil: 0,
    aimAngle: 0,
    facing: 1,
    kills: 0,
    inputs: { up: false, down: false, left: false, right: false }
  };

  socket.emit('init', {
    id: socket.id,
    isHost: onlineRoom.hostId === socket.id,
    onlineFull: Object.keys(onlineRoom.players).length > MAX_ONLINE_PLAYERS,
    settings: onlineRoom.settings,
    currentMap: onlineRoom.currentMap,
    bloodStains: onlineRoom.bloodStains,
    order: onlineRoom.order,
    waveStatus: onlineRoom.waveStatus
  });

  broadcastOnlineLobby();

  // Atualiza prévia no lobby online
  socket.on('updateLobbyProfile', (profile) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.isSolo) return;
    const player = room.players[socket.id];
    if (!player) return;

    if (typeof profile.name === 'string') {
      player.name = profile.name.trim().slice(0, 14) || 'Agente';
    }
    if (['coat', 'hood', 'jacket', 'lab'].includes(profile.outfit)) {
      player.outfit = profile.outfit;
    }
    if (typeof profile.eyeColor === 'string') {
      player.eyeColor = profile.eyeColor;
    }
    if (WEAPONS[profile.weapon]) {
      player.weapon = profile.weapon;
    }
    broadcastOnlineLobby();
  });

  // Líder da sala online atualiza configurações
  socket.on('updateSettings', (newSettings) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.isSolo || socket.id !== room.hostId) return;

    room.settings = sanitizeSettings(newSettings);
    if (room.waveStatus === 'waiting') {
      room.currentMap = room.settings.map;
    }
    io.to('online').emit('settingsUpdated', room.settings);
  });

  // Iniciar partida (Modo Sozinho OU Modo Online)
  socket.on('joinGame', (payload) => {
    const mode = payload.mode === 'solo' ? 'solo' : 'online';
    const profile = payload.profile || {};

    if (mode === 'solo') {
      // Move jogador para uma sala privada exclusiva
      const oldPlayer = getRoomForSocket(socket.id)?.players[socket.id];
      removePlayerFromCurrentRoom(socket);

      const soloRoomId = `solo_${socket.id}`;
      const soloRoom = createRoom(soloRoomId, true);
      soloRoom.hostId = socket.id;
      soloRoom.settings = sanitizeSettings(payload.settings);
      soloRoom.currentMap = soloRoom.settings.map;
      rooms[soloRoomId] = soloRoom;

      socketRoomMap[socket.id] = soloRoomId;
      socket.join(soloRoomId);

      const weaponKey = WEAPONS[profile.weapon] ? profile.weapon : 'pistol';
      const wConfig = WEAPONS[weaponKey];

      soloRoom.players[socket.id] = {
        ...(oldPlayer || {}),
        id: socket.id,
        joined: true,
        name: (profile.name || 'Sombra').trim().slice(0, 14) || 'Sombra',
        outfit: ['coat', 'hood', 'jacket', 'lab'].includes(profile.outfit) ? profile.outfit : 'coat',
        eyeColor: profile.eyeColor || '#ffffff',
        weapon: weaponKey,
        x: 150,
        y: 234,
        hp: 100,
        maxHp: 100,
        ammo: wConfig.clipSize,
        reserve: wConfig.initialReserve,
        reloading: false,
        reloadStart: 0,
        reloadEnd: 0,
        dashTimer: 0,
        dashCooldown: 0,
        dashVx: 1,
        dashVy: 0,
        lastShot: 0,
        lastMelee: 0,
        recoil: 0,
        aimAngle: 0,
        facing: 1,
        kills: 0,
        inputs: { up: false, down: false, left: false, right: false }
      };

      spawnOrder(soloRoom, 1);
      return;
    }

    // Modo Online (até 4 jogadores)
    const room = rooms.online;
    const activeOnlineCount = getJoinedPlayers(room).length;
    if (activeOnlineCount >= MAX_ONLINE_PLAYERS && !room.players[socket.id]?.joined) {
      socket.emit('roomFull', { maxPlayers: MAX_ONLINE_PLAYERS });
      return;
    }

    const player = room.players[socket.id];
    if (!player) return;

    const weaponKey = WEAPONS[profile.weapon] ? profile.weapon : 'pistol';
    const wConfig = WEAPONS[weaponKey];

    player.joined = true;
    player.name = (profile.name || player.name).trim().slice(0, 14) || 'Agente';
    player.outfit = ['coat', 'hood', 'jacket', 'lab'].includes(profile.outfit) ? profile.outfit : 'coat';
    player.eyeColor = profile.eyeColor || '#ffffff';
    player.weapon = weaponKey;
    player.x = 130 + Math.random() * 80;
    player.y = 224 + Math.random() * 20;
    player.hp = 100;
    player.maxHp = 100;
    player.ammo = wConfig.clipSize;
    player.reserve = wConfig.initialReserve;
    player.reloading = false;
    player.dashTimer = 0;
    player.dashCooldown = 0;
    player.kills = 0;

    if (room.waveStatus === 'waiting') {
      room.currentMap = room.settings.map;
      spawnOrder(room, 1);
    }

    broadcastOnlineLobby();
  });

  // Esquiva (Dash - Tecla Shift ou Espaço)
  socket.on('dash', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;
    if (player.dashTimer > 0 || player.dashCooldown > 0) return;

    let dx = 0;
    let dy = 0;
    if (player.inputs.left) dx -= 1;
    if (player.inputs.right) dx += 1;
    if (player.inputs.up) dy -= 1;
    if (player.inputs.down) dy += 1;

    if (dx === 0 && dy === 0) {
      dx = player.facing || 1;
    } else {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }

    player.dashVx = dx;
    player.dashVy = dy;
    player.dashTimer = 0.18;     // 180ms de esquiva com invulnerabilidade
    player.dashCooldown = 1.15;  // 1.15s de recarga

    io.to(room.id).emit('playerDashed', {
      playerId: player.id,
      x: player.x,
      y: player.y,
      dx
    });
  });

  // Interação com a Porta [!] para avançar de mapa
  socket.on('interactDoor', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;
    if (room.waveStatus !== 'door_open') return;

    const mapInfo = MAPS[room.currentMap];
    if (Math.abs(player.x - mapInfo.doorX) > 36) return;

    const currentIdx = MAP_ORDER.indexOf(room.currentMap);
    const nextIdx = (currentIdx + 1) % MAP_ORDER.length;
    room.currentMap = MAP_ORDER[nextIdx];

    room.bloodStains = [];
    room.pickups = [];

    const joined = getJoinedPlayers(room);
    joined.forEach((p, idx) => {
      if (p.hp <= 0) {
        p.hp = 50;
      } else {
        p.hp = Math.min(p.maxHp, p.hp + 15);
      }
      p.x = 85 + idx * 24;
      p.y = 226 + (idx % 2) * 14;
    });

    io.to(room.id).emit('mapChanged', {
      newMap: room.currentMap,
      mapName: MAPS[room.currentMap].name,
      nextOrder: room.order + 1,
      triggeredBy: player.name
    });

    spawnOrder(room, room.order + 1);
  });

  socket.on('input', (data) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;

    if (data.inputs) {
      player.inputs = {
        up: Boolean(data.inputs.up),
        down: Boolean(data.inputs.down),
        left: Boolean(data.inputs.left),
        right: Boolean(data.inputs.right)
      };
    }
    if (typeof data.aimAngle === 'number' && !Number.isNaN(data.aimAngle)) {
      player.aimAngle = data.aimAngle;
      player.facing = Math.cos(data.aimAngle) >= 0 ? 1 : -1;
    }
  });

  socket.on('shoot', (aimAngle) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;

    const now = Date.now();
    const wConfig = WEAPONS[player.weapon];

    if (player.reloading) return;
    if (now - player.lastShot < wConfig.fireRate) return;

    if (typeof aimAngle === 'number' && !Number.isNaN(aimAngle)) {
      player.aimAngle = aimAngle;
      player.facing = Math.cos(aimAngle) >= 0 ? 1 : -1;
    }

    if (wConfig.isMelee) {
      player.lastShot = now;
      performMeleeAttack(room, player, wConfig.damage, wConfig.range, true);
      return;
    }

    if (player.ammo <= 0) {
      socket.emit('emptyClick');
      return;
    }

    player.lastShot = now;
    player.ammo -= 1;
    player.recoil = 1;

    const muzzleX = player.x + Math.cos(player.aimAngle) * 14;
    const muzzleY = player.y - 16 + Math.sin(player.aimAngle) * 8;

    const rays = [];
    const hits = [];

    for (let p = 0; p < wConfig.pellets; p++) {
      const offset = (Math.random() - 0.5) * wConfig.spread;
      const angle = player.aimAngle + offset;
      let endX = muzzleX + Math.cos(angle) * wConfig.range;
      let endY = muzzleY + Math.sin(angle) * wConfig.range;

      endX = Math.max(WORLD.minX - 10, Math.min(WORLD.maxX + 10, endX));
      endY = Math.max(40, Math.min(WORLD.maxY + 4, endY));

      const candidates = room.enemies
        .filter((e) => e.hp > 0)
        .map((e) => {
          const cy = e.y - (e.type === 'crawler' ? 6 : 15);
          return {
            enemy: e,
            cy,
            distRay: pointToSegmentDistance(e.x, cy, muzzleX, muzzleY, endX, endY),
            distPlayer: Math.hypot(e.x - muzzleX, cy - muzzleY)
          };
        })
        .filter((item) => item.distRay <= item.enemy.radius + 5)
        .sort((a, b) => a.distPlayer - b.distPlayer);

      for (const hitItem of candidates) {
        const targetEnemy = hitItem.enemy;
        if (!wConfig.pierce) {
          endX = targetEnemy.x;
          endY = hitItem.cy;
        }

        targetEnemy.hp -= wConfig.damage;
        targetEnemy.hitFlash = 0.14;
        if (targetEnemy.state === 'patrol') {
          targetEnemy.state = 'chase';
          targetEnemy.alertTimer = 1.1;
        }

        const kb = player.weapon === 'shotgun' ? 11 : player.weapon === 'sniper' ? 14 : 4;
        targetEnemy.x += Math.cos(angle) * kb;
        targetEnemy.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, targetEnemy.x));

        hits.push({ x: targetEnemy.x, y: hitItem.cy, type: targetEnemy.type });

        if (targetEnemy.hp <= 0) {
          player.kills += 1;
          addBloodStain(room, targetEnemy.x, targetEnemy.y);
          io.to(room.id).emit('enemyDied', {
            x: targetEnemy.x,
            y: targetEnemy.y,
            type: targetEnemy.type
          });
          if (Math.random() < 0.28) spawnPickup(room);
        }

        if (!wConfig.pierce) break;
      }

      rays.push({ x1: muzzleX, y1: muzzleY, x2: endX, y2: endY });
    }

    room.enemies = room.enemies.filter((e) => e.hp > 0);

    io.to(room.id).emit('shotFired', {
      playerId: player.id,
      weapon: player.weapon,
      x: muzzleX,
      y: muzzleY,
      aimAngle: player.aimAngle,
      rays,
      hits
    });
  });

  socket.on('reload', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;

    const wConfig = WEAPONS[player.weapon];
    if (wConfig.isMelee || player.reloading || player.ammo >= wConfig.clipSize || player.reserve <= 0) return;

    const now = Date.now();
    player.reloading = true;
    player.reloadStart = now;
    player.reloadEnd = now + wConfig.reloadTime;

    io.to(room.id).emit('playerReloading', {
      playerId: player.id,
      x: player.x,
      y: player.y,
      facing: player.facing,
      weapon: player.weapon,
      duration: wConfig.reloadTime
    });
  });

  socket.on('melee', (aimAngle) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.joined || player.hp <= 0) return;

    const now = Date.now();
    if (now - player.lastMelee < 500) return;
    player.lastMelee = now;

    if (typeof aimAngle === 'number' && !Number.isNaN(aimAngle)) {
      player.aimAngle = aimAngle;
      player.facing = Math.cos(aimAngle) >= 0 ? 1 : -1;
    }

    const isKatana = player.weapon === 'katana';
    performMeleeAttack(room, player, isKatana ? 90 : 45, isKatana ? 56 : 42, isKatana);
  });

  function performMeleeAttack(room, player, damage, reach, isBlade) {
    if (isBlade) {
      player.x += Math.cos(player.aimAngle) * 14;
      player.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, player.x));
    }

    const hitX = player.x + Math.cos(player.aimAngle) * 24;
    const hitY = player.y + Math.sin(player.aimAngle) * 14;
    const hits = [];

    for (const enemy of room.enemies) {
      const dist = Math.hypot(enemy.x - hitX, enemy.y - hitY);
      if (dist <= reach) {
        enemy.hp -= damage;
        enemy.hitFlash = 0.16;
        enemy.state = 'chase';
        enemy.x += Math.cos(player.aimAngle) * (isBlade ? 20 : 32);
        enemy.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, enemy.x));
        hits.push({ x: enemy.x, y: enemy.y - 12, type: enemy.type });

        if (enemy.hp <= 0) {
          player.kills += 1;
          addBloodStain(room, enemy.x, enemy.y);
          io.to(room.id).emit('enemyDied', { x: enemy.x, y: enemy.y, type: enemy.type });
        }
      }
    }

    room.enemies = room.enemies.filter((e) => e.hp > 0);

    io.to(room.id).emit('meleeUsed', {
      playerId: player.id,
      x: player.x,
      y: player.y,
      aimAngle: player.aimAngle,
      isBlade,
      hits
    });
  }

  socket.on('restartGame', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const joined = getJoinedPlayers(room);
    if (joined.length === 0) return;

    room.bloodStains = [];
    room.pickups = [];
    room.enemies = [];
    room.currentMap = room.settings.map;

    for (const p of joined) {
      const wConfig = WEAPONS[p.weapon];
      p.hp = 100;
      p.ammo = wConfig.clipSize;
      p.reserve = wConfig.initialReserve;
      p.reloading = false;
      p.dashTimer = 0;
      p.dashCooldown = 0;
      p.kills = 0;
      p.x = 130 + Math.random() * 80;
      p.y = 224 + Math.random() * 20;
    }

    io.to(room.id).emit('gameRestarted');
    spawnOrder(room, 1);
  });

  socket.on('disconnect', () => {
    removePlayerFromCurrentRoom(socket);
  });
});

// Loop principal de simulação de todas as salas ativas (30 FPS)
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;

setInterval(() => {
  const now = Date.now();

  for (const room of Object.values(rooms)) {
    const joinedPlayers = getJoinedPlayers(room);
    if (joinedPlayers.length === 0) continue;

    const alivePlayers = getAlivePlayers(room);

    for (const player of alivePlayers) {
      if (player.recoil > 0) player.recoil = Math.max(0, player.recoil - DT * 6);
      if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - DT);

      if (player.reloading && now >= player.reloadEnd) {
        const wConfig = WEAPONS[player.weapon];
        const needed = wConfig.clipSize - player.ammo;
        const loaded = Math.min(needed, player.reserve);
        player.ammo += loaded;
        player.reserve -= loaded;
        player.reloading = false;
      }

      // Movimentação: Esquiva (Dash) ou Caminhada normal
      if (player.dashTimer > 0) {
        player.dashTimer = Math.max(0, player.dashTimer - DT);
        const dashSpeed = 340;
        player.x += player.dashVx * dashSpeed * DT;
        player.y += player.dashVy * (dashSpeed * 0.65) * DT;
        player.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, player.x));
        player.y = Math.max(WORLD.minY, Math.min(WORLD.maxY, player.y));
      } else {
        let vx = 0;
        let vy = 0;
        if (player.inputs.left) vx -= 1;
        if (player.inputs.right) vx += 1;
        if (player.inputs.up) vy -= 1;
        if (player.inputs.down) vy += 1;

        if (vx !== 0 || vy !== 0) {
          const len = Math.hypot(vx, vy);
          vx /= len;
          vy /= len;
          const moveSpeed = player.weapon === 'katana' ? 124 : 108;
          player.x += vx * moveSpeed * DT;
          player.y += vy * (moveSpeed * 0.65) * DT;

          player.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, player.x));
          player.y = Math.max(WORLD.minY, Math.min(WORLD.maxY, player.y));
        }
      }

      // Coleta de suprimentos
      for (let i = room.pickups.length - 1; i >= 0; i--) {
        const item = room.pickups[i];
        if (Math.hypot(player.x - item.x, player.y - item.y) < 18) {
          if (item.type === 'medkit' && player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + 45);
            room.pickups.splice(i, 1);
            io.to(room.id).emit('pickupCollected', { playerId: player.id, type: 'medkit' });
          } else if (item.type === 'ammo' && !WEAPONS[player.weapon].isMelee) {
            const wConfig = WEAPONS[player.weapon];
            player.reserve += wConfig.clipSize * 2;
            room.pickups.splice(i, 1);
            io.to(room.id).emit('pickupCollected', { playerId: player.id, type: 'ammo' });
          }
        }
      }
    }

    // Derrota total
    if (
      alivePlayers.length === 0 &&
      room.waveStatus !== 'gameover' &&
      room.waveStatus !== 'victory'
    ) {
      room.waveStatus = 'gameover';
      io.to(room.id).emit('gameOver', {
        order: room.order,
        totalOrders: room.settings.totalOrders,
        scoreboard: joinedPlayers.map((p) => ({ name: p.name, kills: p.kills }))
      });
    }

    // IA dos Monstros
    if (room.waveStatus === 'active') {
      for (const enemy of room.enemies) {
        if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - DT);
        if (enemy.alertTimer > 0) enemy.alertTimer = Math.max(0, enemy.alertTimer - DT);
        if (enemy.attackCooldown > 0) enemy.attackCooldown = Math.max(0, enemy.attackCooldown - DT);

        let target = null;
        let minDist = Infinity;
        for (const p of alivePlayers) {
          const d = Math.hypot(p.x - enemy.x, p.y - enemy.y);
          if (d < minDist) {
            minDist = d;
            target = p;
          }
        }

        if (target && (minDist <= enemy.detectRange || enemy.state === 'chase')) {
          if (enemy.state === 'patrol') {
            enemy.state = 'chase';
            enemy.alertTimer = 1.25;
            io.to(room.id).emit('enemyAlert', { id: enemy.id, type: enemy.type });
          }

          const dx = target.x - enemy.x;
          const dy = target.y - enemy.y;
          const dist = Math.hypot(dx, dy) || 1;

          if (dist > 15) {
            enemy.x += (dx / dist) * enemy.speed * DT;
            enemy.y += (dy / dist) * (enemy.speed * 0.65) * DT;
            enemy.facing = dx >= 0 ? 1 : -1;
          } else if (enemy.attackCooldown <= 0 && target.dashTimer <= 0) {
            // Jogador em esquiva (dashTimer > 0) é invulnerável ao golpe!
            enemy.attackCooldown = enemy.attackCdMax;
            target.hp = Math.max(0, target.hp - enemy.damage);
            io.to(room.id).emit('playerDamaged', {
              playerId: target.id,
              hp: target.hp,
              x: target.x,
              y: target.y,
              enemyType: enemy.type
            });
          }
        } else {
          const dx = enemy.patrolTargetX - enemy.x;
          const dy = enemy.patrolTargetY - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 10) {
            enemy.patrolTargetX = WORLD.minX + 50 + Math.random() * (WORLD.width - 100);
            enemy.patrolTargetY = WORLD.minY + 4 + Math.random() * (WORLD.maxY - WORLD.minY - 8);
          } else {
            const patrolSpeed = enemy.speed * 0.4;
            enemy.x += (dx / dist) * patrolSpeed * DT;
            enemy.y += (dy / dist) * (patrolSpeed * 0.65) * DT;
            enemy.facing = dx >= 0 ? 1 : -1;
          }
        }

        enemy.x = Math.max(WORLD.minX, Math.min(WORLD.maxX, enemy.x));
        enemy.y = Math.max(WORLD.minY, Math.min(WORLD.maxY, enemy.y));
      }

      if (room.enemies.length === 0 && alivePlayers.length > 0) {
        if (room.order >= room.settings.totalOrders) {
          room.waveStatus = 'victory';
          io.to(room.id).emit('victory', {
            totalOrders: room.settings.totalOrders,
            scoreboard: joinedPlayers.map((p) => ({ name: p.name, kills: p.kills }))
          });
        } else {
          room.waveStatus = 'door_open';
          io.to(room.id).emit('doorUnlocked', {
            completedOrder: room.order,
            totalOrders: room.settings.totalOrders,
            doorX: MAPS[room.currentMap].doorX
          });
        }
      }
    }

    const currentMapData = MAPS[room.currentMap];

    io.to(room.id).emit('state', {
      isSolo: room.isSolo,
      map: room.currentMap,
      mapName: currentMapData.name,
      doorX: currentMapData.doorX,
      doorUnlocked: room.waveStatus === 'door_open',
      modifier: room.dynamicModifier,
      order: room.order,
      totalOrders: room.settings.totalOrders,
      waveStatus: room.waveStatus,
      players: joinedPlayers.map((p) => {
        const wCfg = WEAPONS[p.weapon];
        const reloadProgress =
          p.reloading && wCfg.reloadTime > 0
            ? Math.max(0, Math.min(1, (now - p.reloadStart) / wCfg.reloadTime))
            : 0;

        return {
          id: p.id,
          name: p.name,
          outfit: p.outfit,
          eyeColor: p.eyeColor,
          weapon: p.weapon,
          x: p.x,
          y: p.y,
          hp: p.hp,
          maxHp: p.maxHp,
          ammo: p.ammo,
          reserve: p.reserve,
          reloading: p.reloading,
          reloadProgress,
          dashing: p.dashTimer > 0,
          dashCooldown: p.dashCooldown,
          recoil: p.recoil,
          aimAngle: p.aimAngle,
          facing: p.facing,
          kills: p.kills,
          moving: p.inputs.up || p.inputs.down || p.inputs.left || p.inputs.right
        };
      }),
      enemies: room.enemies,
      pickups: room.pickups
    });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor DEADLINE 2D rodando em http://localhost:${PORT}`);
});