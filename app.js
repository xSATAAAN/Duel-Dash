import {
  createRoom,
  getClientId,
  getRealtimeInfo,
  joinRoom as joinFirebaseRoom,
  leaveRoom as leaveFirebaseRoom,
  sendRoomAction,
  setRoomHost,
  startRoomDuel,
  subscribeRealtimeInfo,
  subscribeRoom,
  syncPlayerProfile,
} from "./firebase-client.js";

const STORAGE_KEY = "duel-dash-state-v2";
const SETTINGS_KEY = "duel-dash-settings-v1";

const avatars = [
  { id: "nova", name: "Nova", sigil: "NV", gradient: "linear-gradient(135deg,#ff7c52,#ffd372)" },
  { id: "flux", name: "Flux", sigil: "FX", gradient: "linear-gradient(135deg,#4cd7ba,#93f0c7)" },
  { id: "warden", name: "Warden", sigil: "WD", gradient: "linear-gradient(135deg,#8dd0ff,#e6f2ff)" },
  { id: "ember", name: "Ember", sigil: "EM", gradient: "linear-gradient(135deg,#ff8f56,#ff4f5e)" },
  { id: "arc", name: "Arc", sigil: "AR", gradient: "linear-gradient(135deg,#ffd36f,#ff9f43)" },
  { id: "drift", name: "Drift", sigil: "DF", gradient: "linear-gradient(135deg,#6df0db,#4f8cff)" },
];

const blades = [
  { id: "ignite", name: "Ignite Saber", vibe: "Balanced burst", bonus: "Fast attack recovery" },
  { id: "riptide", name: "Riptide Fang", vibe: "Evasive", bonus: "Longer dash window" },
  { id: "comet", name: "Comet Core", vibe: "Heavy finisher", bonus: "Harder special hit" },
  { id: "halo", name: "Halo Edge", vibe: "Control", bonus: "More charge on defense" },
];

const skins = [
  {
    id: "crimson-rush",
    name: "Crimson Rush",
    unlockLevel: 1,
    gradient: "linear-gradient(135deg,#ff7c52,#ff4f5e)",
  },
  {
    id: "jade-circuit",
    name: "Jade Circuit",
    unlockLevel: 3,
    gradient: "linear-gradient(135deg,#47d0b3,#9cf3c7)",
  },
  {
    id: "solar-drive",
    name: "Solar Drive",
    unlockLevel: 6,
    gradient: "linear-gradient(135deg,#ffcb70,#ff8c42)",
  },
  {
    id: "glacier-loop",
    name: "Glacier Loop",
    unlockLevel: 9,
    gradient: "linear-gradient(135deg,#8bd8ff,#e9f4ff)",
  },
  {
    id: "night-shift",
    name: "Night Shift",
    unlockLevel: 12,
    gradient: "linear-gradient(135deg,#7e7bff,#0d1020)",
  },
];

const defaultSettings = {
  sound: true,
};

const defaultState = {
  screen: "onboarding",
  profile: null,
  roomCodeDraft: "",
  roomCodeActive: "",
  roomInviteLink: "",
  rewardedMatchIds: [],
  duel: null,
  overlay: null,
  toast: "",
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `dd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let state = hydrateState();
let settings = hydrateSettings();
let audioCtx;
let loopHandle = null;
let dismissToastTimeout = null;

const roomRuntime = {
  room: null,
  roomUnsubscribe: null,
  infoUnsubscribe: null,
  connected: false,
  serverOffset: 0,
  currentCode: "",
  latestActionId: "",
  fx: { player: "", rival: "", until: 0 },
};

const app = document.getElementById("app");

function hydrateState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) {
      return cloneValue(defaultState);
    }
    const fallbackScreen = raw.profile ? "home" : "onboarding";
    return {
      ...cloneValue(defaultState),
      ...raw,
      screen: raw.screen === "duel" ? "home" : raw.screen || fallbackScreen,
      duel: null,
      overlay: null,
      toast: "",
    };
  } catch {
    return cloneValue(defaultState);
  }
}

function hydrateSettings() {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"),
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveState() {
  const payload = {
    ...state,
    duel: null,
    overlay: null,
    toast: "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function nextLevelXp(level) {
  return 120 + (level - 1) * 55;
}

function currentAvatar() {
  return avatars.find((item) => item.id === state.profile?.avatarId) || avatars[0];
}

function currentSkin() {
  return skins.find((item) => item.id === state.profile?.skinId) || skins[0];
}

function currentBlade() {
  return blades.find((item) => item.id === state.profile?.bladeId) || blades[0];
}

function avatarById(id) {
  return avatars.find((item) => item.id === id) || avatars[0];
}

function skinById(id) {
  return skins.find((item) => item.id === id) || skins[0];
}

function bladeById(id) {
  return blades.find((item) => item.id === id) || blades[0];
}

function availableSkins() {
  if (!state.profile) {
    return [];
  }
  return skins.filter((skin) => state.profile.unlockedSkins.includes(skin.id));
}

function dailyMissionSeed() {
  const now = new Date();
  return now.getDate() + now.getMonth() * 13;
}

function dailyMissions() {
  const seed = dailyMissionSeed();
  const pool = [
    { title: "Win 2 duels", reward: "+45 coins" },
    { title: "Land 4 specials", reward: "+60 XP" },
    { title: "Finish under 30 sec", reward: "+1 skin shard" },
    { title: "Dash through 6 attacks", reward: "+35 coins" },
    { title: "Play 3 matches", reward: "+50 XP" },
  ];
  return [pool[seed % pool.length], pool[(seed + 2) % pool.length]];
}

function randomId(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(dismissToastTimeout);
  dismissToastTimeout = setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function createProfile({ name, avatarId, bladeId }) {
  const starterSkin = skins[0];
  state.profile = {
    name: name.trim() || "Pilot",
    avatarId,
    bladeId,
    skinId: starterSkin.id,
    level: 1,
    xp: 0,
    coins: 240,
    wins: 0,
    losses: 0,
    unlockedSkins: [starterSkin.id],
    restoreCode: `DD-${randomId(4)}-${randomId(4)}`,
  };
  state.screen = "home";
  saveState();
  showToast("Profile created. Duel time.");
}

function addProgress(result) {
  if (!state.profile) {
    return;
  }

  const profile = state.profile;
  const rewards = result === "win" ? { xp: 70, coins: 85 } : { xp: 28, coins: 22 };
  profile.xp += rewards.xp;
  profile.coins += rewards.coins;
  profile[result === "win" ? "wins" : "losses"] += 1;

  let unlocked = null;

  while (profile.xp >= nextLevelXp(profile.level)) {
    profile.xp -= nextLevelXp(profile.level);
    profile.level += 1;

    const skinToUnlock = skins.find(
      (skin) => skin.unlockLevel === profile.level && !profile.unlockedSkins.includes(skin.id),
    );

    if (skinToUnlock) {
      profile.unlockedSkins.push(skinToUnlock.id);
      unlocked = skinToUnlock;
      profile.skinId = skinToUnlock.id;
    }
  }

  if (unlocked) {
    state.overlay = { type: "unlock", skinId: unlocked.id };
  }

  saveState();
  void syncCurrentRoomProfile();
}

function trimRewardedMatches() {
  state.rewardedMatchIds = state.rewardedMatchIds.slice(-12);
}

function roomPlayers() {
  return Object.entries(roomRuntime.room?.players || {}).map(([id, player]) => ({
    id,
    ...player,
  }));
}

function isRoomHost() {
  return roomRuntime.room?.hostId === getClientId();
}

function getServerNow() {
  return Date.now() + roomRuntime.serverOffset;
}

function normalizeTimestamp(value, fallback = getServerNow()) {
  return typeof value === "number" ? value : fallback;
}

function buildRemoteFighter(player) {
  const avatar = avatarById(player.avatarId);
  const skin = skinById(player.skinId);
  return {
    id: player.id,
    name: player.name,
    sigil: avatar.sigil,
    gradient: skin.gradient,
    hp: 100,
    charge: 0,
    evadeUntil: 0,
    cooldowns: { attack: 0, dash: 0, special: 0 },
    flash: "",
  };
}

function pushRoomLog(duel, text, tone = "info") {
  duel.log.unshift({
    id: createUuid(),
    text,
    tone,
  });
  duel.log = duel.log.slice(0, 8);
}

function canUseActionAt(fighter, action, timestamp) {
  if (fighter.cooldowns[action] > timestamp) {
    return false;
  }
  if (action === "special" && fighter.charge < 100) {
    return false;
  }
  return true;
}

function finalizeSimulatedDuel(duel) {
  duel.status = "done";
  duel.winner = duel.player.hp >= duel.rival.hp ? "player" : "rival";
}

function applySimulatedRoomAction(duel, action, playersById, myId) {
  if (duel.status !== "live") {
    return;
  }

  const actorKey = action.actorId === myId ? "player" : "rival";
  const defenderKey = actorKey === "player" ? "rival" : "player";
  const attacker = duel[actorKey];
  const defender = duel[defenderKey];
  const actorBladeId = bladeById(playersById[action.actorId]?.bladeId).id;
  const timestamp = normalizeTimestamp(action.createdAt, duel.startedAt);

  if (timestamp > duel.endsAt || !canUseActionAt(attacker, action.type, timestamp)) {
    return;
  }

  const cooldownDurations = {
    attack: 950,
    dash: actorBladeId === "riptide" ? 1250 : 1500,
    special: 2200,
  };

  attacker.cooldowns[action.type] = timestamp + cooldownDurations[action.type];

  if (action.type === "special") {
    attacker.charge = 0;
  }

  if (action.type === "dash") {
    attacker.evadeUntil = timestamp + (actorBladeId === "riptide" ? 1150 : 850);
    attacker.charge = Math.min(100, attacker.charge + chargeGain("dash", actorBladeId));
    pushRoomLog(duel, `${attacker.name} dashed to bait the next strike.`, "dash");
    return;
  }

  const evaded = defender.evadeUntil > timestamp;
  if (evaded) {
    defender.evadeUntil = 0;
    pushRoomLog(duel, `${defender.name} evaded ${attacker.name}'s ${action.type}.`, "evade");
    return;
  }

  const damage = damageRoll(action.type, actorBladeId);
  defender.hp = Math.max(0, defender.hp - damage);
  attacker.charge = Math.min(100, attacker.charge + chargeGain(action.type, actorBladeId));
  pushRoomLog(
    duel,
    `${attacker.name} hit for ${damage} with ${action.type === "special" ? "Burst Core" : "Quick Strike"}.`,
    action.type === "special" ? "special" : "hit",
  );

  if (defender.hp <= 0) {
    finalizeSimulatedDuel(duel);
  }
}

function applyRoomFxFromLatestAction(room) {
  const actions = Object.entries(room?.duel?.actions || {});
  if (actions.length === 0) {
    return;
  }

  const sortedActions = actions.sort((left, right) => left[0].localeCompare(right[0]));
  const latestPair = sortedActions[sortedActions.length - 1];
  if (!latestPair) {
    return;
  }
  const [latestId, latestAction] = latestPair;
  if (latestId === roomRuntime.latestActionId) {
    return;
  }

  roomRuntime.latestActionId = latestId;
  const isPlayer = latestAction.actorId === getClientId();
  roomRuntime.fx = {
    player: isPlayer ? (latestAction.type === "dash" ? "evade" : latestAction.type) : latestAction.type === "dash" ? "" : "hit",
    rival: isPlayer ? (latestAction.type === "dash" ? "" : "hit") : latestAction.type === "dash" ? "evade" : latestAction.type,
    until: Date.now() + 260,
  };

  const tone = latestAction.type === "special" ? "special" : latestAction.type === "dash" ? "dash" : "hit";
  playTone(tone);
}

function buildRoomDuel(room) {
  if (!room?.duel) {
    return null;
  }

  const myId = getClientId();
  const playersById = room.players || {};
  const rivalId = Object.keys(playersById).find((id) => id !== myId);
  if (!playersById[myId] || !rivalId) {
    return null;
  }

  const me = playersById[myId];
  const rival = playersById[rivalId];
  const startedAt = normalizeTimestamp(room.duel.startedAt);
  const duel = {
    mode: "room",
    status: room.duel.status || "live",
    startedAt,
    endsAt: startedAt + (room.duel.durationMs || 90000),
    player: buildRemoteFighter(me),
    rival: buildRemoteFighter(rival),
    log: [
      {
        id: createUuid(),
        tone: "start",
        text: `${me.name} and ${rival.name} entered room ${room.code}.`,
      },
    ],
    winner: null,
    roomCode: room.code,
    matchId: room.duel.id || `${room.code}-match`,
  };

  const actions = Object.entries(room.duel.actions || {})
    .map(([id, value]) => ({
      id,
      ...value,
      createdAt: normalizeTimestamp(value?.createdAt, startedAt),
    }))
    .filter((item) => item.actorId && item.type)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));

  actions.forEach((action) => {
    applySimulatedRoomAction(duel, action, playersById, myId);
  });

  if (duel.status === "live" && getServerNow() >= duel.endsAt) {
    finalizeSimulatedDuel(duel);
  }

  if (roomRuntime.fx.until > Date.now()) {
    duel.player.flash = roomRuntime.fx.player;
    duel.rival.flash = roomRuntime.fx.rival;
  }

  return duel;
}

function applyRoomMatchRewards(duel) {
  if (!duel || duel.mode !== "room" || duel.status !== "done") {
    return;
  }

  if (state.rewardedMatchIds.includes(duel.matchId)) {
    return;
  }

  addProgress(duel.winner === "player" ? "win" : "loss");
  state.rewardedMatchIds.push(duel.matchId);
  trimRewardedMatches();
  saveState();
  showToast(duel.winner === "player" ? "Room duel won. Rewards added." : "Room duel lost. Rewards added.");
}

async function repairRoomHost(room) {
  const players = roomPlayers();
  if (players.length === 0) {
    return;
  }

  if (room.hostId && room.players?.[room.hostId]) {
    return;
  }

  const nextHostId = players
    .map((player) => player.id)
    .sort((left, right) => left.localeCompare(right))[0];

  if (nextHostId === getClientId()) {
    await setRoomHost(room.code, nextHostId);
  }
}

function setRoomInvite(code) {
  state.roomCodeActive = code;
  state.roomCodeDraft = code;
  state.roomInviteLink = `${location.origin}${location.pathname}#room=${code}`;
}

function detachRoomSubscription() {
  if (roomRuntime.roomUnsubscribe) {
    roomRuntime.roomUnsubscribe();
    roomRuntime.roomUnsubscribe = null;
  }
  roomRuntime.room = null;
  roomRuntime.currentCode = "";
  roomRuntime.latestActionId = "";
  roomRuntime.fx = { player: "", rival: "", until: 0 };
}

function clearActiveRoomState() {
  if (state.duel?.mode === "room") {
    state.duel = null;
  }
  state.roomCodeActive = "";
  state.roomInviteLink = "";
  state.roomCodeDraft = "";
  saveState();
}

function attachRoomSubscription(code) {
  detachRoomSubscription();
  roomRuntime.currentCode = code;
  roomRuntime.roomUnsubscribe = subscribeRoom(code, async (room) => {
    roomRuntime.room = room;

    if (!room) {
      clearDuelTimers();
      clearActiveRoomState();
      state.screen = "rooms";
      render();
      return;
    }

    setRoomInvite(room.code || code);
    await repairRoomHost(room);
    applyRoomFxFromLatestAction(room);

    const roomDuel = buildRoomDuel(room);
    if (roomDuel) {
      state.duel = roomDuel;
      applyRoomMatchRewards(roomDuel);
      if (roomDuel.status === "live") {
        state.screen = "duel";
        runLoop();
      }
    } else if (state.duel?.mode === "room") {
      clearDuelTimers();
      state.duel = null;
    }

    saveState();
    render();
  });
}

async function syncCurrentRoomProfile() {
  if (!state.profile || !state.roomCodeActive) {
    return;
  }

  try {
    await syncPlayerProfile(state.roomCodeActive, state.profile);
  } catch {
    showToast("Room profile sync failed.");
  }
}

function createDuel(mode = "practice", rivalName = "Rogue Flux") {
  const avatar = currentAvatar();
  const skin = currentSkin();
  const rivalSkin = skins[(Math.floor(Math.random() * (skins.length - 1)) + 1) % skins.length];

  return {
    mode,
    status: "live",
    startedAt: Date.now(),
    endsAt: Date.now() + 90_000,
    player: {
      name: state.profile.name,
      sigil: avatar.sigil,
      gradient: skin.gradient,
      hp: 100,
      charge: 0,
      evadeUntil: 0,
      cooldowns: { attack: 0, dash: 0, special: 0 },
      flash: "",
    },
    rival: {
      name: rivalName,
      sigil: "RX",
      gradient: rivalSkin.gradient,
      hp: 100,
      charge: 0,
      evadeUntil: 0,
      cooldowns: { attack: 0, dash: 0, special: 0 },
      flash: "",
    },
    log: [
      {
        id: createUuid(),
        tone: "start",
        text: `${state.profile.name} enters the arena. ${rivalName} is ready.`,
      },
    ],
    winner: null,
    roomCode: state.roomCodeActive,
    nextAiAt: Date.now() + 1100,
  };
}

function duelTimeLeft() {
  if (!state.duel) {
    return 0;
  }
  return Math.max(0, Math.ceil((state.duel.endsAt - Date.now()) / 1000));
}

function damageRoll(type, bladeId) {
  const bonus = bladeId === "comet" ? 4 : 0;
  if (type === "special") {
    return 22 + Math.floor(Math.random() * 8) + bonus;
  }
  return 10 + Math.floor(Math.random() * 6);
}

function chargeGain(type, bladeId) {
  if (type === "dash") {
    return bladeId === "halo" ? 38 : 25;
  }
  return type === "attack" ? 34 : 0;
}

function now() {
  return state.duel?.mode === "room" ? getServerNow() : Date.now();
}

function canUseAction(fighter, action) {
  if (!state.duel || state.duel.status !== "live") {
    return false;
  }
  if (fighter.cooldowns[action] > now()) {
    return false;
  }
  if (action === "special" && fighter.charge < 100) {
    return false;
  }
  return true;
}

function pushLog(text, tone = "info") {
  state.duel.log.unshift({
    id: createUuid(),
    text,
    tone,
  });
  state.duel.log = state.duel.log.slice(0, 8);
}

function markFlash(side, flash) {
  state.duel[side].flash = flash;
  setTimeout(() => {
    if (!state.duel) {
      return;
    }
    state.duel[side].flash = "";
    render();
  }, 260);
}

function finishDuel() {
  const duel = state.duel;
  if (!duel || duel.status !== "live") {
    return;
  }

  duel.status = "done";

  if (duel.player.hp === duel.rival.hp) {
    duel.winner = duel.player.hp >= duel.rival.hp ? "player" : "rival";
  } else {
    duel.winner = duel.player.hp > duel.rival.hp ? "player" : "rival";
  }

  if (duel.winner === "player") {
    pushLog(`${state.profile.name} wins the clash and claims the arena.`, "win");
    addProgress("win");
    playTone("win");
  } else {
    pushLog(`${duel.rival.name} steals the match on the final beat.`, "loss");
    addProgress("loss");
    playTone("loss");
  }

  clearDuelTimers();
  saveState();
  render();
}

function resolveAction(attackerKey, defenderKey, action) {
  if (!state.duel || state.duel.status !== "live") {
    return;
  }

  const attacker = state.duel[attackerKey];
  const defender = state.duel[defenderKey];
  const actorBladeId = attackerKey === "player" ? state.profile.bladeId : "ignite";
  const timestamp = now();

  if (!canUseAction(attacker, action)) {
    return;
  }

  const cooldownDurations = {
    attack: 950,
    dash: actorBladeId === "riptide" ? 1250 : 1500,
    special: 2200,
  };

  attacker.cooldowns[action] = timestamp + cooldownDurations[action];
  if (action === "special") {
    attacker.charge = 0;
  }

  if (action === "dash") {
    attacker.evadeUntil = timestamp + (actorBladeId === "riptide" ? 1150 : 850);
    attacker.charge = Math.min(100, attacker.charge + chargeGain(action, actorBladeId));
    markFlash(attackerKey, "evade");
    pushLog(`${attacker.name} dashed through the lane and primed a counter.`, "dash");
    playTone("dash");
    render();
    return;
  }

  const evaded = defender.evadeUntil > timestamp;
  if (evaded) {
    defender.evadeUntil = 0;
    markFlash(defenderKey, "evade");
    pushLog(`${defender.name} slipped past ${attacker.name}'s ${action}.`, "evade");
    playTone("miss");
  } else {
    const damage = damageRoll(action, actorBladeId);
    defender.hp = Math.max(0, defender.hp - damage);
    attacker.charge =
      action === "special"
        ? attacker.charge
        : Math.min(100, attacker.charge + chargeGain(action, actorBladeId));
    markFlash(attackerKey, action);
    markFlash(defenderKey, "hit");
    pushLog(
      `${attacker.name} landed ${action === "special" ? "a charged finisher" : "a clean strike"} for ${damage}.`,
      action === "special" ? "special" : "hit",
    );
    playTone(action === "special" ? "special" : "hit");
  }

  if (defender.hp <= 0) {
    finishDuel();
    return;
  }

  render();
}

function aiAct() {
  if (!state.duel || state.duel.status !== "live") {
    return;
  }

  const duel = state.duel;
  const rival = duel.rival;
  const player = duel.player;
  const ready = {
    attack: canUseAction(rival, "attack"),
    dash: canUseAction(rival, "dash"),
    special: canUseAction(rival, "special"),
  };

  let action = "attack";

  if (ready.special && player.hp <= 40) {
    action = "special";
  } else if (ready.dash && Math.random() > 0.7 && player.charge >= 68) {
    action = "dash";
  } else if (!ready.attack && ready.dash) {
    action = "dash";
  } else if (ready.special && Math.random() > 0.82) {
    action = "special";
  } else if (ready.attack) {
    action = "attack";
  } else if (ready.dash) {
    action = "dash";
  } else {
    return;
  }

  resolveAction("rival", "player", action);
  duel.nextAiAt = now() + 950 + Math.floor(Math.random() * 650);
}

function runLoop() {
  clearDuelTimers();
  loopHandle = setInterval(() => {
    if (!state.duel) {
      clearDuelTimers();
      return;
    }

    if (state.duel.mode === "room") {
      if (roomRuntime.room) {
        state.duel = buildRoomDuel(roomRuntime.room);
        applyRoomMatchRewards(state.duel);
      }
      render();
      if (!state.duel || state.duel.status !== "live") {
        clearDuelTimers();
      }
      return;
    }

    if (state.duel.status !== "live") {
      clearDuelTimers();
      return;
    }

    if (now() >= state.duel.endsAt) {
      finishDuel();
      return;
    }

    if (now() >= state.duel.nextAiAt) {
      aiAct();
    }

    render();
  }, 120);
}

function clearDuelTimers() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function startPracticeDuel() {
  state.screen = "duel";
  state.duel = createDuel("practice", "Rogue Flux");
  render();
  runLoop();
}

async function openRoom() {
  if (state.roomCodeActive) {
    await leaveActiveRoom();
  }

  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomId();
    try {
      const code = await createRoom(state.profile, candidate);
      setRoomInvite(code);
      attachRoomSubscription(code);
      state.screen = "rooms";
      saveState();
      render();
      return true;
    } catch (error) {
      lastError = error;
      if (error?.message !== "Room code already exists.") {
        break;
      }
    }
  }

  showToast(lastError?.message || "Room creation failed.");
  return false;
}

async function joinRoom() {
  const code = state.roomCodeDraft.trim().toUpperCase();
  if (code.length < 4) {
    showToast("Enter a valid room code.");
    return false;
  }

  if (state.roomCodeActive && state.roomCodeActive !== code) {
    await leaveActiveRoom();
  }

  try {
    const joinedCode = await joinFirebaseRoom(state.profile, code);
    setRoomInvite(joinedCode);
    attachRoomSubscription(joinedCode);
    state.screen = "rooms";
    saveState();
    render();
    return true;
  } catch (error) {
    showToast(error?.message || "Could not join room.");
    return false;
  }
}

async function leaveActiveRoom() {
  if (!state.roomCodeActive) {
    return;
  }

  try {
    await leaveFirebaseRoom(state.roomCodeActive);
  } catch {
    showToast("Leaving room failed.");
  }

  detachRoomSubscription();
  clearDuelTimers();
  clearActiveRoomState();
  state.screen = "rooms";
  render();
}

async function startLiveRoomMatch() {
  if (!state.roomCodeActive) {
    return;
  }

  try {
    await startRoomDuel(state.roomCodeActive);
    showToast("Live room match started.");
  } catch (error) {
    showToast(error?.message || "Could not start match.");
  }
}

async function submitLiveAction(action) {
  if (!state.roomCodeActive || !state.duel || state.duel.mode !== "room") {
    return;
  }

  if (!canUseAction(state.duel.player, action)) {
    return;
  }

  try {
    await sendRoomAction(state.roomCodeActive, action);
  } catch {
    showToast("Action sync failed.");
  }
}

function copyRoomLink() {
  if (!state.roomInviteLink) {
    return;
  }
  navigator.clipboard
    .writeText(state.roomInviteLink)
    .then(() => showToast("Invite link copied."))
    .catch(() => showToast("Copy blocked on this browser."));
}

function restoreHashRoom() {
  const room = location.hash.startsWith("#room=") ? location.hash.replace("#room=", "") : "";
  if (room && /^[A-Z0-9]{4,8}$/i.test(room)) {
    setRoomInvite(room.toUpperCase());
  }
}

function resetProgress() {
  clearDuelTimers();
  localStorage.removeItem(STORAGE_KEY);
  state = cloneValue(defaultState);
  detachRoomSubscription();
  render();
}

function playTone(type) {
  if (!settings.sound) {
    return;
  }
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor) {
    return;
  }
  const context = audioCtx || new AudioContextCtor();
  audioCtx = context;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  const tones = {
    hit: [280, 180],
    special: [190, 380],
    dash: [410, 560],
    miss: [120, 90],
    win: [280, 360],
    loss: [160, 110],
  };

  const [startFreq, endFreq] = tones[type] || [260, 180];

  oscillator.type = type === "special" ? "square" : "triangle";
  oscillator.frequency.setValueAtTime(startFreq, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(endFreq, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
}

function levelProgress() {
  if (!state.profile) {
    return 0;
  }
  return Math.round((state.profile.xp / nextLevelXp(state.profile.level)) * 100);
}

function actionButton(label, action, detail) {
  const duel = state.duel;
  if (!duel) {
    return "";
  }

  const fighter = duel.player;
  const cooldownMax = {
    attack: 950,
    dash: state.profile.bladeId === "riptide" ? 1250 : 1500,
    special: 2200,
  };
  const cooldownLeft = Math.max(0, fighter.cooldowns[action] - now());
  const percent = Math.round((cooldownLeft / cooldownMax[action]) * 100);
  const specialReady = fighter.charge >= 100;
  const disabled = !canUseAction(fighter, action);

  return `
    <button class="action-button" data-action="${action}" ${disabled ? "disabled" : ""}>
      <span class="tag">${label}</span>
      <strong>${detail.title}</strong>
      <span class="tiny">${detail.copy}</span>
      ${
        action === "special"
          ? `<div class="cooldown-track"><div class="cooldown-fill" style="width:${disabled && !specialReady ? 100 : percent}%;"></div></div>`
          : `<div class="cooldown-track"><div class="cooldown-fill" style="width:${percent}%;"></div></div>`
      }
    </button>
  `;
}

function renderOnboarding() {
  return `
    <section class="stack reveal">
      <article class="hero">
        <span class="eyebrow">PvP-ready PWA</span>
        <h1 class="title">Duel Dash</h1>
        <p class="subtitle">
          A sharp 1v1 brawler with fast rounds, native-feel polish, and profile progression.
        </p>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Create your fighter</h2>
            <p class="muted">No signup wall. Your profile is saved on this device instantly.</p>
          </div>
          <span class="pill">Step 1</span>
        </div>
        <form id="onboarding-form" class="stack">
          <label class="stack">
            <span class="tiny">Pilot name</span>
            <input
              type="text"
              name="name"
              maxlength="16"
              placeholder="Type your duelist name"
              required
            />
          </label>

          <div class="stack">
            <span class="tiny">Choose avatar</span>
            <div class="avatar-grid">
              ${avatars
                .map(
                  (avatar, index) => `
                    <button
                      type="button"
                      class="choice-card ${index === 0 ? "is-selected" : ""}"
                      data-avatar="${avatar.id}"
                    >
                      <span class="avatar-sigil" style="background:${avatar.gradient};">${avatar.sigil}</span>
                      <strong>${avatar.name}</strong>
                      <span class="tiny">Arena signature</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <input type="hidden" name="avatarId" value="${avatars[0].id}" />
          </div>

          <div class="stack">
            <span class="tiny">Starter blade</span>
            <div class="weapon-grid">
              ${blades
                .map(
                  (blade, index) => `
                    <button
                      type="button"
                      class="choice-card ${index === 0 ? "is-selected" : ""}"
                      data-blade="${blade.id}"
                    >
                      <strong>${blade.name}</strong>
                      <span class="tiny">${blade.vibe}</span>
                      <p class="tiny">${blade.bonus}</p>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <input type="hidden" name="bladeId" value="${blades[0].id}" />
          </div>

          <button class="btn btn-primary" type="submit">Enter the Arena</button>
        </form>
      </article>
    </section>
  `;
}

function renderHome() {
  const profile = state.profile;
  const avatar = currentAvatar();
  const skin = currentSkin();
  const blade = currentBlade();
  const missions = dailyMissions();

  return `
    <section class="stack reveal">
      <article class="hero">
        <div class="profile-strip">
          <span class="eyebrow">Level ${profile.level}</span>
          <span class="pill">${profile.coins} coins</span>
        </div>
        <h1 class="title">Ready for the next clash, ${profile.name}?</h1>
        <p class="subtitle">
          Create a room, quick duel a practice rival, and keep unlocking new skins every few wins.
        </p>
        <div class="stack">
          <div class="xp-track"><div class="xp-fill" style="width:${levelProgress()}%;"></div></div>
          <div class="profile-strip">
            <span class="tiny">${profile.xp} / ${nextLevelXp(profile.level)} XP</span>
            <span class="tiny">Restore code: ${profile.restoreCode}</span>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Profile</h2>
            <p class="muted">Designed to feel like an actual game account, minus the signup friction.</p>
          </div>
          <span class="pill">${avatar.name}</span>
        </div>

        <div class="stack">
          <div class="profile-strip">
            <div class="inline">
              <span class="avatar-sigil" style="background:${skin.gradient};">${avatar.sigil}</span>
              <div>
                <strong>${profile.name}</strong>
                <div class="tiny">${blade.name} equipped</div>
              </div>
            </div>
            <span class="pill">${skin.name}</span>
          </div>

          <div class="metric-row">
            <div class="metric">
              <strong>${profile.wins}</strong>
              <span>Wins</span>
            </div>
            <div class="metric">
              <strong>${profile.losses}</strong>
              <span>Losses</span>
            </div>
            <div class="metric">
              <strong>${availableSkins().length}</strong>
              <span>Skins</span>
            </div>
          </div>

          <div class="grid-2">
            <button class="btn btn-primary" data-nav="duel">Quick Duel</button>
            <button class="btn btn-secondary" data-nav="rooms">Create Room</button>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Loadout</h2>
            <p class="muted">Everything is stored locally so the app opens like a real game, not a website.</p>
          </div>
          <button class="pill" data-open-overlay="locker">Locker</button>
        </div>
        <div class="inventory-row">
          <div class="metric">
            <strong>${blade.name}</strong>
            <span>${blade.bonus}</span>
          </div>
          <div class="metric">
            <strong>${skin.name}</strong>
            <span>Equipped skin</span>
          </div>
          <div class="metric">
            <strong>${avatar.name}</strong>
            <span>Current avatar</span>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Daily pulse</h2>
            <p class="muted">Simple loops that keep progression alive without heavy backend work.</p>
          </div>
          <span class="pill">2 missions</span>
        </div>
        <div class="stack">
          ${missions
            .map(
              (mission) => `
                <div class="metric">
                  <strong>${mission.title}</strong>
                  <span>${mission.reward}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function renderRooms() {
  const players = roomPlayers();
  const hasActiveRoom = Boolean(roomRuntime.room);
  const roomStatus =
    state.duel?.mode === "room" && state.duel.roomCode === state.roomCodeActive
      ? state.duel.status
      : roomRuntime.room?.duel?.status || roomRuntime.room?.status || "idle";
  const liveDuelReady = players.length === 2;
  const canStart = hasActiveRoom && isRoomHost() && liveDuelReady;

  return `
    <section class="stack reveal">
      <article class="hero">
        <span class="eyebrow">Room flow</span>
        <h1 class="title">Fast invites.</h1>
        <p class="subtitle">
          Firebase is now wired for room sync. Create a code, get your friend in, then start the live duel.
        </p>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Create room</h2>
            <p class="muted">This creates a real Firebase room with host control and live event sync.</p>
          </div>
          <button class="pill" data-room="generate">New code</button>
        </div>
        <div class="stack">
          <div class="metric">
            <strong>${state.roomCodeActive || "------"}</strong>
            <span>${roomRuntime.connected ? "Firebase connected" : "Waiting for database connection"}</span>
          </div>
          <button class="btn btn-primary" data-room="copy" ${state.roomInviteLink ? "" : "disabled"}>
            Copy invite link
          </button>
          <button class="btn btn-accent" data-room="start-live" ${canStart ? "" : "disabled"}>
            ${roomStatus === "live" ? "Match already live" : isRoomHost() ? "Start live duel" : "Host starts the duel"}
          </button>
          <button class="btn btn-secondary" data-room="open-duel" ${roomStatus === "live" || roomStatus === "done" ? "" : "disabled"}>
            Open current room match
          </button>
          <button class="btn btn-secondary" data-room="leave" ${hasActiveRoom ? "" : "disabled"}>
            Leave room
          </button>
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Join room</h2>
            <p class="muted">Join from your own iPhone or from the invite link hash.</p>
          </div>
          <span class="pill">Ready</span>
        </div>
        <div class="stack">
          <label class="stack">
            <span class="tiny">Paste code</span>
            <input
              id="room-code-input"
              type="text"
              maxlength="8"
              value="${state.roomCodeDraft}"
              placeholder="ABCD12"
            />
          </label>
          <button class="btn btn-secondary" data-room="join">Join room</button>
          <div class="metric">
            <strong>${players.length}/2 players</strong>
            <span>${hasActiveRoom ? `Status: ${roomStatus}` : "No active room attached yet."}</span>
          </div>
          ${
            players.length
              ? `
                <div class="stack">
                  ${players
                    .map(
                      (player) => `
                        <div class="metric">
                          <strong>${player.name}${player.id === roomRuntime.room?.hostId ? " (Host)" : ""}</strong>
                          <span>${bladeById(player.bladeId).name} · Level ${player.level || 1}</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<p class="tiny">When a room is active, both players appear here in realtime.</p>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderDuel() {
  const duel = state.duel;
  if (!duel) {
    return "";
  }

  const timeLeft = duelTimeLeft();
  const playerHp = Math.round((duel.player.hp / 100) * 100);
  const rivalHp = Math.round((duel.rival.hp / 100) * 100);

  return `
    <section class="stack reveal">
      <article class="hero">
        <div class="profile-strip">
          <span class="eyebrow">${duel.mode === "practice" ? "Practice duel" : "Room duel"}</span>
          <span class="pill">${state.roomCodeActive || "Arena"}</span>
        </div>
        <h1 class="title">Fight fast.</h1>
        <p class="subtitle">
          ${
            duel.mode === "practice"
              ? "Practice keeps the combat loop sharp while you wait for a second player."
              : `${roomRuntime.connected ? "Realtime sync active." : "Realtime connection unstable."} Every action comes from Firebase room events.`
          }
        </p>
      </article>

      <article class="duel-stage">
        <div class="battle-top">
          <div class="fighter is-player">
            <div class="fighter-name">
              <strong>${duel.player.name}</strong>
              <span class="pill">${duel.player.hp} HP</span>
            </div>
            <div class="hp-track"><div class="hp-fill" style="width:${playerHp}%;"></div></div>
            <div class="battle-footer">
              <div class="metric">
                <strong>${Math.round(duel.player.charge)}%</strong>
                <span>Charge</span>
              </div>
            </div>
            <div class="charge-track"><div class="charge-fill" style="width:${duel.player.charge}%;"></div></div>
          </div>

          <div class="timer-stack hud-value">
            <strong>${timeLeft}s</strong>
            <span>${duel.status === "done" ? (duel.winner === "player" ? "Victory" : "Defeat") : "Arena timer"}</span>
          </div>

          <div class="fighter is-rival">
            <div class="fighter-name">
              <strong>${duel.rival.name}</strong>
              <span class="pill">${duel.rival.hp} HP</span>
            </div>
            <div class="hp-track"><div class="hp-fill" style="width:${rivalHp}%;"></div></div>
            <div class="battle-footer">
              <div class="metric">
                <strong>${Math.round(duel.rival.charge)}%</strong>
                <span>Charge</span>
              </div>
            </div>
            <div class="charge-track"><div class="charge-fill" style="width:${duel.rival.charge}%;"></div></div>
          </div>
        </div>

        <div class="arena-lane">
          <div
            class="runner player ${duel.player.flash}"
            style="background:${duel.player.gradient};"
          >
            ${duel.player.sigil}
          </div>
          <div
            class="runner enemy ${duel.rival.flash}"
            style="background:${duel.rival.gradient};"
          >
            ${duel.rival.sigil}
          </div>
        </div>

        <div class="action-grid">
          ${actionButton("Tap", "attack", {
            title: "Quick Strike",
            copy: "Fast hit. Builds charge.",
          })}
          ${actionButton("Swipe", "dash", {
            title: "Dash",
            copy: "Evade the next attack.",
          })}
          ${actionButton("Hold", "special", {
            title: "Burst Core",
            copy: duel.player.charge >= 100 ? "Finisher is ready." : "Fill charge to 100%.",
          })}
        </div>
      </article>

      <article class="card">
        <div class="section-head">
          <div>
            <h2>Combat log</h2>
            <p class="muted">
              ${
                duel.mode === "practice"
                  ? "Practice mode runs locally against the demo rival."
                  : "This log is reconstructed from the shared room action stream."
              }
            </p>
          </div>
          <button class="pill" data-duel="${duel.mode === "practice" ? "restart" : "rooms"}">
            ${duel.mode === "practice" ? "Rematch" : "Back to room"}
          </button>
        </div>
        <div class="log-list">
          ${duel.log
            .map(
              (entry) => `
                <div class="log-item">
                  <strong>${entry.tone}</strong><br />
                  ${entry.text}
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function lockerOverlay() {
  const profile = state.profile;
  const selectedSkin = currentSkin();
  return `
    <div class="overlay" data-close-overlay="true">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-head">
          <div>
            <h2>Locker</h2>
            <p class="muted">Skins unlock automatically every few levels.</p>
          </div>
          <button class="pill" data-close-overlay="true">Close</button>
        </div>
        <div class="skin-grid">
          ${skins
            .map((skin) => {
              const unlocked = profile.unlockedSkins.includes(skin.id);
              const selected = selectedSkin.id === skin.id;
              return `
                <button
                  class="choice-card ${selected ? "is-selected" : ""}"
                  data-skin="${skin.id}"
                  ${unlocked ? "" : "disabled"}
                >
                  <span class="skin-sigil" style="background:${skin.gradient};"></span>
                  <strong>${skin.name}</strong>
                  <span class="tiny">${unlocked ? "Unlocked" : `Unlocks at L${skin.unlockLevel}`}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function unlockOverlay() {
  const skin = skins.find((item) => item.id === state.overlay?.skinId);
  if (!skin) {
    return "";
  }
  return `
    <div class="overlay" data-close-unlock="true">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-head">
          <div>
            <h2>New skin unlocked</h2>
            <p class="muted">Your progression loop is working exactly like a full game shell.</p>
          </div>
          <button class="pill" data-close-unlock="true">Nice</button>
        </div>
        <div class="stack">
          <div class="skin-sigil" style="background:${skin.gradient}; height:7rem;"></div>
          <div class="metric">
            <strong>${skin.name}</strong>
            <span>Automatically equipped at level ${state.profile.level}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderToast() {
  return `
    <div class="toast-wrap ${state.toast ? "" : "hide"}">
      <div class="toast">${state.toast}</div>
    </div>
  `;
}

function renderNav() {
  if (!state.profile || state.screen === "onboarding") {
    return "";
  }
  return `
    <nav class="footer-nav">
      <button class="nav-chip ${state.screen === "home" ? "is-active" : ""}" data-nav="home">Home</button>
      <button class="nav-chip ${state.screen === "duel" ? "is-active" : ""}" data-nav="duel">Duel</button>
      <button class="nav-chip ${state.screen === "rooms" ? "is-active" : ""}" data-nav="rooms">Rooms</button>
      <button class="nav-chip" data-open-overlay="locker">Locker</button>
    </nav>
  `;
}

function render(attachEvents = true) {
  const screenMap = {
    onboarding: renderOnboarding(),
    home: renderHome(),
    rooms: renderRooms(),
    duel: renderDuel(),
  };

  app.innerHTML = `
    <main class="app-shell">
      ${screenMap[state.screen]}
      ${renderNav()}
    </main>
    ${
      state.overlay?.type === "locker"
        ? lockerOverlay()
        : state.overlay?.type === "unlock"
          ? unlockOverlay()
          : ""
    }
    ${renderToast()}
  `;

  if (attachEvents) {
    bindEvents();
  }
}

function bindChoiceCards(form, selector, inputName, datasetKey, activeClass = "is-selected") {
  form.querySelectorAll(selector).forEach((button) => {
    button.addEventListener("click", () => {
      form.querySelectorAll(selector).forEach((item) => item.classList.remove(activeClass));
      button.classList.add(activeClass);
      form.elements[inputName].value = button.dataset[datasetKey];
    });
  });
}

function bindEvents() {
  const onboardingForm = document.getElementById("onboarding-form");
  if (onboardingForm) {
    bindChoiceCards(onboardingForm, "[data-avatar]", "avatarId", "avatar");
    bindChoiceCards(onboardingForm, "[data-blade]", "bladeId", "blade");

    onboardingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(onboardingForm);
      createProfile({
        name: String(formData.get("name") || "").slice(0, 16),
        avatarId: String(formData.get("avatarId") || avatars[0].id),
        bladeId: String(formData.get("bladeId") || blades[0].id),
      });
      if (state.roomCodeActive) {
        state.screen = "rooms";
        render();
        void joinRoom();
        return;
      }
      render();
    });
  }

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const nav = button.dataset.nav;
      if (nav === "duel") {
        if (roomRuntime.room?.duel) {
          state.screen = "duel";
          render();
          return;
        }
        if (state.roomCodeActive) {
          state.screen = "rooms";
          render();
          return;
        }
        startPracticeDuel();
        return;
      }
      clearDuelTimers();
      state.screen = nav;
      render();
    });
  });

  document.querySelectorAll("[data-open-overlay]").forEach((button) => {
    button.addEventListener("click", () => {
      state.overlay = { type: button.dataset.openOverlay };
      render();
    });
  });

  document.querySelectorAll("[data-close-overlay]").forEach((button) => {
    button.addEventListener("click", () => {
      state.overlay = null;
      render();
    });
  });

  document.querySelectorAll("[data-close-unlock]").forEach((button) => {
    button.addEventListener("click", () => {
      state.overlay = null;
      render();
    });
  });

  document.querySelectorAll("[data-skin]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.profile.unlockedSkins.includes(button.dataset.skin)) {
        return;
      }
      state.profile.skinId = button.dataset.skin;
      saveState();
      void syncCurrentRoomProfile();
      render();
    });
  });

  document.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.room;
      if (action === "generate") {
        if (await openRoom()) {
          showToast("Live room created.");
        }
      }
      if (action === "copy") {
        copyRoomLink();
      }
      if (action === "join") {
        if (await joinRoom()) {
          showToast(`Joined room ${state.roomCodeActive}.`);
        }
      }
      if (action === "start-live") {
        await startLiveRoomMatch();
      }
      if (action === "open-duel" && roomRuntime.room?.duel) {
        state.screen = "duel";
        render();
      }
      if (action === "leave") {
        await leaveActiveRoom();
      }
    });
  });

  const roomCodeInput = document.getElementById("room-code-input");
  if (roomCodeInput) {
    roomCodeInput.addEventListener("input", (event) => {
      state.roomCodeDraft = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.duel?.mode === "room") {
        void submitLiveAction(button.dataset.action);
        return;
      }
      resolveAction("player", "rival", button.dataset.action);
    });
  });

  document.querySelectorAll("[data-duel='restart']").forEach((button) => {
    button.addEventListener("click", () => {
      startPracticeDuel();
    });
  });

  document.querySelectorAll("[data-duel='rooms']").forEach((button) => {
    button.addEventListener("click", () => {
      state.screen = "rooms";
      render();
    });
  });
}

restoreHashRoom();
roomRuntime.infoUnsubscribe = subscribeRealtimeInfo((info) => {
  roomRuntime.connected = info.connected;
  roomRuntime.serverOffset = info.serverOffset;
  render();
});

render();
saveSettings();

if (state.profile && state.roomCodeActive) {
  attachRoomSubscription(state.roomCodeActive);
  void joinRoom();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

window.DuelDashDev = {
  resetProgress,
  state,
};
