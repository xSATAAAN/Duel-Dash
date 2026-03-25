const STORAGE_KEY = "duel-dash-state-v2";
const DEFAULT_ROOM_STATUS = "ادخل الساحة وانتظر خصمًا ثانيًا.";

const defaultProfile = {
  name: "المقاتل",
  level: 1,
  coins: 240,
  gems: 18,
  avatarSigil: "DD",
};

const appState = {
  screen: "lobby",
  profile: hydrateProfile(),
  matchmaking: false,
};

const elements = {
  lobby: document.getElementById("game-lobby"),
  arena: document.getElementById("arena-container"),
  canvas: document.getElementById("game-canvas"),
  backToLobby: document.getElementById("back-to-lobby"),
  findMatch: document.getElementById("find-match-button"),
  playerName: document.getElementById("player-name"),
  playerLevel: document.getElementById("player-level"),
  playerCoins: document.getElementById("player-coins"),
  playerGems: document.getElementById("player-gems"),
  playerAvatarSigil: document.getElementById("player-avatar-sigil"),
  lobbyStatus: document.getElementById("lobby-status"),
  arenaStatus: document.getElementById("arena-status"),
};

const runtime = {
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,
  frameId: 0,
  lastFrameTime: 0,
  firebaseApi: null,
  roomCode: "",
  unsubscribeRoom: null,
  syncIntervalId: 0,
  syncInFlight: false,
  localClientId: "",
  hostId: "",
  matchActive: false,
  landscapeLockAttempted: false,
  playerOne: createPlayerEntity({
    slot: 1,
    name: "الأول",
    primary: "#38bdf8",
    secondary: "#67e8f9",
  }),
  playerTwo: createPlayerEntity({
    slot: 2,
    name: "الثاني",
    primary: "#f43f5e",
    secondary: "#fb7185",
  }),
  joystick: {
    active: false,
    pointerId: null,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    vectorX: 0,
    vectorY: 0,
    radius: 54,
  },
  lastSentPosition: null,
};

function createPlayerEntity({ slot, name, primary, secondary }) {
  return {
    slot,
    id: "",
    name,
    primary,
    secondary,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    width: 76,
    height: 132,
    speed: 310,
    direction: slot === 1 ? 1 : -1,
    connected: false,
    initialized: false,
    phase: Math.random() * Math.PI * 2,
  };
}

function hydrateProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const profile = raw?.profile || {};
    const name = String(profile.name || defaultProfile.name).trim() || defaultProfile.name;
    return {
      ...defaultProfile,
      ...profile,
      name,
      level: Number(profile.level || defaultProfile.level),
      coins: Number(profile.coins || defaultProfile.coins),
      gems: Number(profile.gems || defaultProfile.gems),
      avatarSigil: String(
        profile.avatarSigil ||
          name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0] || "")
            .join("")
            .toUpperCase() ||
            defaultProfile.avatarSigil,
      ).slice(0, 2),
    };
  } catch {
    return { ...defaultProfile };
  }
}

function persistProfile() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      profile: appState.profile,
    }),
  );
}

function populateLobby() {
  elements.playerName.textContent = appState.profile.name;
  elements.playerLevel.textContent = `المستوى ${appState.profile.level}`;
  elements.playerCoins.textContent = String(appState.profile.coins);
  elements.playerGems.textContent = String(appState.profile.gems);
  elements.playerAvatarSigil.textContent = appState.profile.avatarSigil;
}

function setLobbyStatus(message) {
  elements.lobbyStatus.textContent = message;
}

function setArenaStatus(message) {
  elements.arenaStatus.textContent = message;
}

function setFindMatchBusy(busy) {
  appState.matchmaking = busy;
  elements.findMatch.disabled = busy;
  elements.findMatch.querySelector("span").textContent = busy ? "جارٍ البحث..." : "ابحث عن خصم";
}

function setScreen(screen) {
  appState.screen = screen;
  elements.lobby.style.display = screen === "lobby" ? "flex" : "none";
  elements.arena.style.display = screen === "arena" ? "block" : "none";

  if (screen === "arena") {
    resizeCanvas();
    startGameLoop();
  } else {
    stopGameLoop();
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pathRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function resizeCanvas() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = elements.canvas;

  runtime.width = width;
  runtime.height = height;
  runtime.dpr = dpr;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  runtime.ctx = runtime.ctx || canvas.getContext("2d");
  runtime.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  runtime.joystick.radius = clamp(Math.round(Math.min(width, height) * 0.1), 42, 74);

  const localPlayer = getLocalPlayer();
  const remotePlayer = getRemotePlayer();
  if (localPlayer) {
    constrainPlayer(localPlayer);
    localPlayer.targetX = localPlayer.x;
    localPlayer.targetY = localPlayer.y;
  }
  if (remotePlayer) {
    constrainPlayer(remotePlayer);
  }

  if (!runtime.playerOne.initialized) {
    seedEntity(runtime.playerOne, 1, true);
  }
  if (!runtime.playerTwo.initialized) {
    seedEntity(runtime.playerTwo, 2, true);
  }

  renderFrame(performance.now());
}

function getSpawnPoint(slot) {
  return {
    x: runtime.width * (slot === 1 ? 0.22 : 0.78),
    y: runtime.height * 0.72,
  };
}

function seedEntity(entity, slot, force = false) {
  if (entity.initialized && !force) {
    return;
  }

  const spawn = getSpawnPoint(slot);
  entity.x = spawn.x;
  entity.y = spawn.y;
  entity.targetX = spawn.x;
  entity.targetY = spawn.y;
  entity.direction = slot === 1 ? 1 : -1;
  entity.initialized = true;
  constrainPlayer(entity);
}

function constrainPlayer(player) {
  if (!runtime.width || !runtime.height) {
    return;
  }

  const halfWidth = player.width * 0.5;
  const topLimit = runtime.height * 0.34;
  const bottomLimit = runtime.height * 0.79;

  player.x = clamp(player.x, halfWidth + 18, runtime.width - halfWidth - 18);
  player.y = clamp(player.y, topLimit, bottomLimit);
}

function normalizePosition(position) {
  return {
    x: Number(position?.x || 0),
    y: Number(position?.y || 0),
    direction: Number(position?.direction) === -1 ? -1 : 1,
  };
}

function isValidPosition(position) {
  return Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y));
}

function getLocalPlayer() {
  if (!runtime.localClientId) {
    return null;
  }
  if (runtime.playerOne.id === runtime.localClientId) {
    return runtime.playerOne;
  }
  if (runtime.playerTwo.id === runtime.localClientId) {
    return runtime.playerTwo;
  }
  return null;
}

function getRemotePlayer() {
  if (!runtime.localClientId) {
    return null;
  }
  if (runtime.playerOne.id && runtime.playerOne.id !== runtime.localClientId) {
    return runtime.playerOne;
  }
  if (runtime.playerTwo.id && runtime.playerTwo.id !== runtime.localClientId) {
    return runtime.playerTwo;
  }
  return null;
}

function assignEntity(entity, payload, slot) {
  if (!payload) {
    entity.id = "";
    entity.name = slot === 1 ? "المقاتل الأول" : "في الانتظار";
    entity.connected = false;
    seedEntity(entity, slot, !entity.initialized);
    return;
  }

  entity.id = payload.id || "";
  entity.name = payload.name || (slot === 1 ? "المقاتل الأول" : "المقاتل الثاني");
  entity.connected = true;

  if (isValidPosition(payload.position)) {
    const position = normalizePosition(payload.position);
    entity.targetX = position.x;
    entity.targetY = position.y;
    entity.direction = position.direction;

    const boundedTarget = { ...entity, x: entity.targetX, y: entity.targetY };
    constrainPlayer(boundedTarget);
    entity.targetX = boundedTarget.x;
    entity.targetY = boundedTarget.y;

    if (!entity.initialized) {
      entity.x = entity.targetX;
      entity.y = entity.targetY;
      entity.initialized = true;
    }
  } else if (!entity.initialized) {
    seedEntity(entity, slot, true);
  }

  constrainPlayer(entity);
}

function updateRoomState(room) {
  if (!room) {
    setArenaStatus("تم إغلاق الغرفة. ارجع إلى اللوبي ثم حاول مجددًا.");
    return;
  }

  runtime.hostId = room.hostId || "";
  const players = room.players || {};
  const playerIds = Object.keys(players);
  const slotOneId =
    runtime.hostId && players[runtime.hostId]
      ? runtime.hostId
      : playerIds.length > 0
        ? playerIds[0]
        : "";
  const slotTwoId = playerIds.find((id) => id !== slotOneId) || "";

  assignEntity(runtime.playerOne, slotOneId ? players[slotOneId] : null, 1);
  assignEntity(runtime.playerTwo, slotTwoId ? players[slotTwoId] : null, 2);

  const localPlayer = getLocalPlayer();
  if (localPlayer && !isValidPosition(players[runtime.localClientId]?.position)) {
    localPlayer.targetX = localPlayer.x;
    localPlayer.targetY = localPlayer.y;
    runtime.lastSentPosition = null;
    void syncLocalPlayerPosition(true);
  }

  if (slotTwoId) {
    setArenaStatus(`الغرفة ${runtime.roomCode} جاهزة. الخصم متصل.`);
    setLobbyStatus("تم العثور على خصم. الساحة تعمل الآن.");
  } else {
    setArenaStatus(`الغرفة ${runtime.roomCode}. في انتظار مقاتل ثان.`);
  }
}

function updateLocalPlayer(deltaSeconds) {
  const player = getLocalPlayer();
  if (!player) {
    return;
  }

  const vectorX = runtime.joystick.vectorX;
  const vectorY = runtime.joystick.vectorY;
  if (!vectorX && !vectorY) {
    return;
  }

  const previousX = player.x;
  const previousY = player.y;
  player.x += vectorX * player.speed * deltaSeconds;
  player.y += vectorY * player.speed * deltaSeconds;
  constrainPlayer(player);

  if (Math.abs(player.x - previousX) > 0.3 || Math.abs(player.y - previousY) > 0.3) {
    player.targetX = player.x;
    player.targetY = player.y;
    player.direction = vectorX < -0.1 ? -1 : vectorX > 0.1 ? 1 : player.direction;
  }
}

function updateRemotePlayer(deltaSeconds) {
  const remotePlayer = getRemotePlayer();
  if (!remotePlayer || !remotePlayer.connected) {
    return;
  }

  const smoothing = clamp(deltaSeconds * 8.5, 0.08, 0.24);
  remotePlayer.x += (remotePlayer.targetX - remotePlayer.x) * smoothing;
  remotePlayer.y += (remotePlayer.targetY - remotePlayer.y) * smoothing;
  constrainPlayer(remotePlayer);
}

function drawBackground(context, width, height, timeSeconds) {
  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, "#020617");
  backdrop.addColorStop(0.56, "#0f172a");
  backdrop.addColorStop(1, "#111827");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const leftGlow = context.createRadialGradient(width * 0.22, height * 0.18, 0, width * 0.22, height * 0.18, width * 0.32);
  leftGlow.addColorStop(0, "rgba(34, 211, 238, 0.34)");
  leftGlow.addColorStop(1, "rgba(34, 211, 238, 0)");
  context.fillStyle = leftGlow;
  context.fillRect(0, 0, width, height);

  const rightGlow = context.createRadialGradient(width * 0.8, height * 0.14, 0, width * 0.8, height * 0.14, width * 0.34);
  rightGlow.addColorStop(0, "rgba(244, 63, 94, 0.26)");
  rightGlow.addColorStop(1, "rgba(244, 63, 94, 0)");
  context.fillStyle = rightGlow;
  context.fillRect(0, 0, width, height);

  const horizonY = height * 0.38;
  const floorTop = height * 0.58;
  const skylineGradient = context.createLinearGradient(0, horizonY - 100, 0, floorTop);
  skylineGradient.addColorStop(0, "rgba(148, 163, 184, 0.06)");
  skylineGradient.addColorStop(1, "rgba(15, 23, 42, 0.22)");
  context.fillStyle = skylineGradient;
  for (let index = 0; index < 18; index += 1) {
    const buildingWidth = width * (0.04 + (index % 4) * 0.015);
    const buildingHeight = height * (0.08 + ((index * 7) % 5) * 0.03);
    const x = (index / 18) * width;
    const y = floorTop - buildingHeight;
    context.fillRect(x, y, buildingWidth, buildingHeight);
  }

  const floorGradient = context.createLinearGradient(0, floorTop, 0, height);
  floorGradient.addColorStop(0, "rgba(34, 211, 238, 0.06)");
  floorGradient.addColorStop(0.22, "rgba(15, 23, 42, 0.3)");
  floorGradient.addColorStop(1, "rgba(2, 6, 23, 0.96)");
  context.fillStyle = floorGradient;
  context.fillRect(0, floorTop, width, height - floorTop);

  context.save();
  context.strokeStyle = "rgba(56, 189, 248, 0.18)";
  context.lineWidth = 1;
  for (let row = 0; row < 9; row += 1) {
    const progress = row / 8;
    const y = floorTop + progress * progress * (height - floorTop);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  for (let column = -10; column <= 10; column += 1) {
    const x = width / 2 + column * width * 0.06;
    context.beginPath();
    context.moveTo(x, floorTop);
    context.lineTo(width / 2 + column * width * 0.18, height);
    context.stroke();
  }
  context.restore();

  context.save();
  const pulseAlpha = 0.14 + Math.sin(timeSeconds * 1.8) * 0.04;
  context.strokeStyle = `rgba(103, 232, 249, ${pulseAlpha})`;
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(width / 2, floorTop + height * 0.07, width * 0.22, height * 0.08, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawShadow(context, x, y, width, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = "#020617";
  context.beginPath();
  context.ellipse(x, y + 18, width * 0.56, width * 0.18, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPlayer(context, player, timeSeconds) {
  const groundedY = player.y;
  const breathe = Math.sin(timeSeconds * 2 + player.phase) * 4;
  const x = player.x;
  const y = groundedY + breathe;

  drawShadow(context, x, groundedY, player.width, player.connected ? 0.34 : 0.18);

  context.save();
  context.translate(x, y);
  context.scale(player.direction, 1);

  const opacity = player.connected ? 1 : 0.44;
  context.globalAlpha = opacity;

  const armorGradient = context.createLinearGradient(-player.width * 0.35, -player.height, player.width * 0.35, 0);
  armorGradient.addColorStop(0, player.secondary);
  armorGradient.addColorStop(1, player.primary);

  context.fillStyle = player.primary;
  context.shadowColor = player.primary;
  context.shadowBlur = player.connected ? 18 : 10;

  context.beginPath();
  context.moveTo(-26, -64);
  context.lineTo(0, -86);
  context.lineTo(26, -64);
  context.lineTo(18, -26);
  context.lineTo(-18, -26);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.fillStyle = armorGradient;
  pathRoundedRect(context, -28, -26, 56, 64, 18);
  context.fill();

  context.fillStyle = "rgba(248, 250, 252, 0.92)";
  pathRoundedRect(context, -14, -58, 28, 18, 8);
  context.fill();

  context.fillStyle = "#0f172a";
  pathRoundedRect(context, -10, -54, 20, 10, 5);
  context.fill();

  context.fillStyle = player.secondary;
  context.beginPath();
  context.moveTo(-38, -12);
  context.lineTo(-14, -4);
  context.lineTo(-14, 10);
  context.lineTo(-38, 4);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(38, -12);
  context.lineTo(14, -4);
  context.lineTo(14, 10);
  context.lineTo(38, 4);
  context.closePath();
  context.fill();

  context.fillStyle = "#cbd5e1";
  pathRoundedRect(context, -22, 34, 16, 54, 10);
  context.fill();
  pathRoundedRect(context, 6, 34, 16, 54, 10);
  context.fill();

  context.fillStyle = player.primary;
  context.beginPath();
  context.moveTo(-12, -18);
  context.lineTo(-38, -40);
  context.lineTo(-24, -4);
  context.closePath();
  context.fill();

  context.fillStyle = player.secondary;
  context.beginPath();
  context.moveTo(12, -18);
  context.lineTo(46, -2);
  context.lineTo(10, 4);
  context.closePath();
  context.fill();

  context.restore();

  context.save();
  context.textAlign = "center";
  context.font = "700 18px Changa";
  context.fillStyle = "#f8fafc";
  context.fillText(player.name, x, groundedY - player.height - 24);
  context.font = "500 12px Changa";
  context.fillStyle = player.connected ? "rgba(203, 213, 225, 0.92)" : "rgba(203, 213, 225, 0.64)";
  context.fillText(player.connected ? (player.slot === 1 ? "Blue Slot" : "Red Slot") : "في الانتظار", x, groundedY - player.height - 6);
  context.restore();
}

function drawArenaHud(context) {
  context.save();
  context.textAlign = "right";
  context.font = "700 20px Changa";
  context.fillStyle = "#f8fafc";
  context.fillText("ساحة التحرك", runtime.width - 24, 38);

  context.font = "500 12px Changa";
  context.fillStyle = "rgba(203, 213, 225, 0.9)";
  context.fillText(`Room: ${runtime.roomCode || "--"}`, runtime.width - 24, 58);
  context.fillText("حرّك المقاتل من الجهة اليسرى السفلية", runtime.width - 24, 76);

  context.textAlign = "left";
  context.fillStyle = "rgba(248, 250, 252, 0.78)";
  context.fillText(runtime.playerOne.name, 24, 38);
  context.fillStyle = "rgba(248, 250, 252, 0.56)";
  context.fillText(runtime.playerTwo.connected ? runtime.playerTwo.name : "بانتظار خصم", 24, 58);
  context.restore();
}

function drawJoystick(context) {
  const guideX = runtime.width * 0.14;
  const guideY = runtime.height * 0.8;
  const baseX = runtime.joystick.active ? runtime.joystick.baseX : guideX;
  const baseY = runtime.joystick.active ? runtime.joystick.baseY : guideY;
  const knobX = runtime.joystick.active ? runtime.joystick.knobX : baseX;
  const knobY = runtime.joystick.active ? runtime.joystick.knobY : baseY;
  const radius = runtime.joystick.radius;

  context.save();
  context.globalAlpha = runtime.joystick.active ? 0.96 : 0.42;
  context.fillStyle = "rgba(15, 23, 42, 0.52)";
  context.strokeStyle = "rgba(56, 189, 248, 0.58)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(baseX, baseY, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(56, 189, 248, 0.92)";
  context.shadowColor = "rgba(34, 211, 238, 0.7)";
  context.shadowBlur = 18;
  context.beginPath();
  context.arc(knobX, knobY, radius * 0.44, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function renderFrame(timestamp) {
  if (!runtime.ctx || !runtime.width || !runtime.height) {
    return;
  }

  const timeSeconds = timestamp * 0.001;
  runtime.ctx.clearRect(0, 0, runtime.width, runtime.height);
  drawBackground(runtime.ctx, runtime.width, runtime.height, timeSeconds);
  drawArenaHud(runtime.ctx);
  drawPlayer(runtime.ctx, runtime.playerOne, timeSeconds);
  drawPlayer(runtime.ctx, runtime.playerTwo, timeSeconds);
  drawJoystick(runtime.ctx);
}

function startGameLoop() {
  if (runtime.frameId) {
    return;
  }

  runtime.lastFrameTime = performance.now();
  const step = (timestamp) => {
    runtime.frameId = window.requestAnimationFrame(step);
    const deltaMs = Math.min(32, timestamp - runtime.lastFrameTime || 16);
    runtime.lastFrameTime = timestamp;
    updateLocalPlayer(deltaMs / 1000);
    updateRemotePlayer(deltaMs / 1000);
    renderFrame(timestamp);
  };

  runtime.frameId = window.requestAnimationFrame(step);
}

function stopGameLoop() {
  if (!runtime.frameId) {
    return;
  }

  window.cancelAnimationFrame(runtime.frameId);
  runtime.frameId = 0;
}

function getCanvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function activateJoystick(point, pointerId) {
  runtime.joystick.active = true;
  runtime.joystick.pointerId = pointerId;
  runtime.joystick.baseX = point.x;
  runtime.joystick.baseY = point.y;
  runtime.joystick.knobX = point.x;
  runtime.joystick.knobY = point.y;
  runtime.joystick.vectorX = 0;
  runtime.joystick.vectorY = 0;
}

function updateJoystick(point) {
  const deltaX = point.x - runtime.joystick.baseX;
  const deltaY = point.y - runtime.joystick.baseY;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const clampedDistance = Math.min(distance, runtime.joystick.radius);
  const normalizedX = deltaX / distance;
  const normalizedY = deltaY / distance;

  runtime.joystick.knobX = runtime.joystick.baseX + normalizedX * clampedDistance;
  runtime.joystick.knobY = runtime.joystick.baseY + normalizedY * clampedDistance;
  runtime.joystick.vectorX = Number((deltaX / runtime.joystick.radius).toFixed(3));
  runtime.joystick.vectorY = Number((deltaY / runtime.joystick.radius).toFixed(3));

  if (Math.abs(runtime.joystick.vectorX) > 1 || Math.abs(runtime.joystick.vectorY) > 1) {
    const vectorLength = Math.hypot(runtime.joystick.vectorX, runtime.joystick.vectorY) || 1;
    runtime.joystick.vectorX /= vectorLength;
    runtime.joystick.vectorY /= vectorLength;
  }
}

function resetJoystick() {
  runtime.joystick.active = false;
  runtime.joystick.pointerId = null;
  runtime.joystick.vectorX = 0;
  runtime.joystick.vectorY = 0;
}

function syncNeeded(nextPosition) {
  if (!runtime.lastSentPosition) {
    return true;
  }

  const deltaX = Math.abs(nextPosition.x - runtime.lastSentPosition.x);
  const deltaY = Math.abs(nextPosition.y - runtime.lastSentPosition.y);
  const directionChanged = nextPosition.direction !== runtime.lastSentPosition.direction;
  return deltaX >= 1.4 || deltaY >= 1.4 || directionChanged;
}

async function syncLocalPlayerPosition(force = false) {
  if (
    !runtime.firebaseApi ||
    !runtime.roomCode ||
    runtime.syncInFlight ||
    appState.screen !== "arena"
  ) {
    return;
  }

  const localPlayer = getLocalPlayer();
  if (!localPlayer) {
    return;
  }

  const nextPosition = {
    x: Number(localPlayer.x.toFixed(1)),
    y: Number(localPlayer.y.toFixed(1)),
    direction: localPlayer.direction,
  };

  if (!force && !syncNeeded(nextPosition)) {
    return;
  }

  runtime.syncInFlight = true;
  try {
    await runtime.firebaseApi.syncPlayerPosition(runtime.roomCode, nextPosition);
    runtime.lastSentPosition = nextPosition;
  } catch {
    setArenaStatus("تعذر مزامنة الحركة الآن.");
  } finally {
    runtime.syncInFlight = false;
  }
}

function startPositionSync() {
  stopPositionSync();
  runtime.syncIntervalId = window.setInterval(() => {
    void syncLocalPlayerPosition(false);
  }, 50);
}

function stopPositionSync() {
  if (runtime.syncIntervalId) {
    window.clearInterval(runtime.syncIntervalId);
    runtime.syncIntervalId = 0;
  }
}

async function loadFirebaseApi() {
  if (runtime.firebaseApi) {
    return runtime.firebaseApi;
  }

  runtime.firebaseApi = await import("./firebase-client.js");
  runtime.localClientId = runtime.firebaseApi.getClientId();
  return runtime.firebaseApi;
}

async function enterArenaMatch() {
  if (appState.matchmaking) {
    return;
  }

  setFindMatchBusy(true);
  setLobbyStatus("جار فتح غرفة اللعب السريع...");
  setArenaStatus("جارٍ تجهيز الاتصال...");
  setScreen("arena");

  try {
    const firebaseApi = await loadFirebaseApi();
    runtime.roomCode = await firebaseApi.findOrCreateArenaRoom(appState.profile);
    setArenaStatus(`تم فتح الغرفة ${runtime.roomCode}.`);
    runtime.unsubscribeRoom?.();
    runtime.unsubscribeRoom = firebaseApi.subscribeRoom(runtime.roomCode, updateRoomState);
    startPositionSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر بدء الساحة الآن.";
    setArenaStatus(message);
    setLobbyStatus(message);
    await exitArenaMatch({ skipLeave: true });
    setScreen("lobby");
  } finally {
    setFindMatchBusy(false);
  }
}

async function exitArenaMatch({ skipLeave = false } = {}) {
  stopPositionSync();
  runtime.unsubscribeRoom?.();
  runtime.unsubscribeRoom = null;
  resetJoystick();

  if (!skipLeave && runtime.firebaseApi && runtime.roomCode) {
    try {
      await runtime.firebaseApi.leaveRoom(runtime.roomCode);
    } catch {}
  }

  runtime.roomCode = "";
  runtime.hostId = "";
  runtime.lastSentPosition = null;
  runtime.playerOne = createPlayerEntity({
    slot: 1,
    name: "الأول",
    primary: "#38bdf8",
    secondary: "#67e8f9",
  });
  runtime.playerTwo = createPlayerEntity({
    slot: 2,
    name: "الثاني",
    primary: "#f43f5e",
    secondary: "#fb7185",
  });
  seedEntity(runtime.playerOne, 1, true);
  seedEntity(runtime.playerTwo, 2, true);
  setArenaStatus(DEFAULT_ROOM_STATUS);
}

async function lockLandscape() {
  if (runtime.landscapeLockAttempted) {
    return;
  }

  const orientationApi = globalThis.screen?.orientation;
  if (!orientationApi?.lock) {
    return;
  }

  runtime.landscapeLockAttempted = true;
  try {
    await orientationApi.lock("landscape");
  } catch {}
}

function handlePointerDown(event) {
  if (appState.screen !== "arena") {
    return;
  }

  const point = getCanvasPoint(event);
  const insideJoystickZone = point.x <= runtime.width * 0.42 && point.y >= runtime.height * 0.46;
  if (!insideJoystickZone) {
    return;
  }

  activateJoystick(point, event.pointerId);
  elements.canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event) {
  if (!runtime.joystick.active || event.pointerId !== runtime.joystick.pointerId) {
    return;
  }

  updateJoystick(getCanvasPoint(event));
  event.preventDefault();
}

function handlePointerUp(event) {
  if (!runtime.joystick.active || event.pointerId !== runtime.joystick.pointerId) {
    return;
  }

  resetJoystick();
  elements.canvas.releasePointerCapture?.(event.pointerId);
  event.preventDefault();
}

function bindEvents() {
  elements.findMatch.addEventListener("click", () => {
    void enterArenaMatch();
  });

  elements.backToLobby.addEventListener("click", () => {
    void (async () => {
      await exitArenaMatch();
      setLobbyStatus(DEFAULT_ROOM_STATUS);
      setScreen("lobby");
    })();
  });

  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("pointermove", handlePointerMove);
  elements.canvas.addEventListener("pointerup", handlePointerUp);
  elements.canvas.addEventListener("pointercancel", handlePointerUp);

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => {
    resizeCanvas();
    void lockLandscape();
  });
  window.addEventListener(
    "pointerdown",
    () => {
      void lockLandscape();
    },
    { once: true },
  );
  window.addEventListener("beforeunload", () => {
    if (runtime.firebaseApi && runtime.roomCode) {
      void runtime.firebaseApi.leaveRoom(runtime.roomCode);
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function init() {
  populateLobby();
  persistProfile();
  runtime.ctx = elements.canvas.getContext("2d");
  setLobbyStatus(DEFAULT_ROOM_STATUS);
  setArenaStatus(DEFAULT_ROOM_STATUS);
  setScreen("lobby");
  bindEvents();
  resizeCanvas();
  void lockLandscape();
  registerServiceWorker();
  window.__duelDashBooted = true;
}

init();
