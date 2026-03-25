import {
  ASSET_URLS,
  collectPreloadUrls,
  getAbilityImage,
  getBladeImage,
  getFighterImage,
  getSkinImage,
} from "./game-assets.js";

const STORAGE_KEY = "duel-dash-state-v2";
const SETTINGS_KEY = "duel-dash-settings-v1";
const CLIENT_ID_KEY = "duel-dash-client-id-v1";

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

function getAppClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const next = `p-${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

let firebaseApiPromise = null;

async function loadFirebaseApi() {
  if (!firebaseApiPromise) {
    firebaseApiPromise = import("./firebase-client.js").catch((error) => {
      firebaseApiPromise = null;
      throw error;
    });
  }

  return firebaseApiPromise;
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
  latestActionType: "",
  latestActorSide: "",
  fx: { player: "", rival: "", until: 0 },
};

const bootRuntime = {
  ready: false,
  progress: 0,
  started: false,
  exiting: false,
};

const uiRuntime = {
  shakeUntil: 0,
  shakeIntensity: 6,
  floatingTexts: [],
};

const audioRuntime = {
  unlocked: false,
  lobbyTrack: null,
};

const app = document.getElementById("app");
let orientationLockAttempted = false;

normalizeProfileState(state);

async function tryLockLandscape() {
  if (orientationLockAttempted) {
    return;
  }

  const orientationApi = globalThis.screen?.orientation;
  if (!orientationApi?.lock) {
    return;
  }

  orientationLockAttempted = true;
  try {
    await orientationApi.lock("landscape");
  } catch (error) {
    console.error(error);
  }
}

function preloadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(url);
    image.onerror = () => resolve(url);
    image.src = url;
  });
}

async function bootAssets() {
  if (bootRuntime.started) {
    return;
  }

  bootRuntime.started = true;
  render();

  const urls = collectPreloadUrls();
  const total = Math.max(urls.length, 1);
  const startedAt = Date.now();
  let loaded = 0;

  await Promise.all(
    urls.map((url) =>
      preloadImage(url).then(() => {
        loaded += 1;
        bootRuntime.progress = Math.round((loaded / total) * 100);
        render();
      }),
    ),
  );

  const elapsed = Date.now() - startedAt;
  if (elapsed < 1400) {
    await new Promise((resolve) => setTimeout(resolve, 1400 - elapsed));
  }

  bootRuntime.progress = 100;
  bootRuntime.exiting = true;
  render();
  await new Promise((resolve) => setTimeout(resolve, 360));
  bootRuntime.ready = true;
  bootRuntime.exiting = false;
  void tryLockLandscape();
  render();
}

function unlockAudio() {
  if (audioRuntime.unlocked) {
    return;
  }
  audioRuntime.unlocked = true;
}

function playSfx(kind) {
  if (!settings.sound) {
    return;
  }
  const source = ASSET_URLS.audio[kind];
  if (audioRuntime.unlocked && source) {
    const audio = new Audio(source);
    audio.volume = kind === "lobbyBgm" ? 0.32 : 0.74;
    audio.play().catch(() => {});
    return;
  }

  const toneMap = {
    hit: "hit",
    dash: "dash",
    special: "special",
    win: "win",
    loss: "loss",
  };
  if (toneMap[kind]) {
    playTone(toneMap[kind]);
  }
}

function startLobbyMusic() {
  if (!audioRuntime.unlocked || !ASSET_URLS.audio.lobbyBgm) {
    return;
  }

  if (!audioRuntime.lobbyTrack) {
    audioRuntime.lobbyTrack = new Audio(ASSET_URLS.audio.lobbyBgm);
    audioRuntime.lobbyTrack.loop = true;
    audioRuntime.lobbyTrack.volume = 0.26;
  }

  audioRuntime.lobbyTrack.play().catch(() => {});
}

function stopLobbyMusic() {
  if (!audioRuntime.lobbyTrack) {
    return;
  }
  audioRuntime.lobbyTrack.pause();
  audioRuntime.lobbyTrack.currentTime = 0;
}

function syncAudioForScreen() {
  if (!bootRuntime.ready) {
    return;
  }
  if (state.screen === "duel") {
    stopLobbyMusic();
  } else {
    startLobbyMusic();
  }
}

function triggerScreenShake(intensity = 6) {
  uiRuntime.shakeIntensity = intensity;
  uiRuntime.shakeUntil = Date.now() + 320;
}

function showFloatingText(x, y, text, type = "damage") {
  const item = {
    id: createUuid(),
    x,
    y,
    text,
    variant: type,
  };
  uiRuntime.floatingTexts.push(item);
  render();
  setTimeout(() => {
    uiRuntime.floatingTexts = uiRuntime.floatingTexts.filter((entry) => entry.id !== item.id);
    render();
  }, 1000);
}

function spawnFloatingText(side, value, variant = "damage") {
  const x = side === "player" ? 28 : 72;
  const y = variant === "evade" ? 40 : 36;
  const text = variant === "evade" ? "تفادي" : `-${value}`;
  showFloatingText(x, y, text, variant);
}

window.addEventListener(
  "pointerdown",
  () => {
    unlockAudio();
    syncAudioForScreen();
    void tryLockLandscape();
  },
  { once: true },
);

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

function normalizeProfileState(source) {
  if (!source?.profile) {
    return;
  }

  if (typeof source.profile.gems !== "number") {
    source.profile.gems = 18;
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
    { title: "اكسب مباراتين", reward: "+45 كوين" },
    { title: "نفّذ 4 ضربات خاصة", reward: "+60 XP" },
    { title: "أنهِ مواجهة خلال 30 ثانية", reward: "+1 شظية سكن" },
    { title: "تفادَ 6 هجمات بالاندفاعة", reward: "+35 كوين" },
    { title: "العب 3 مباريات", reward: "+50 XP" },
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
    name: name.trim() || "لاعب",
    avatarId,
    bladeId,
    skinId: starterSkin.id,
    level: 1,
    xp: 0,
    coins: 240,
    gems: 18,
    wins: 0,
    losses: 0,
    unlockedSkins: [starterSkin.id],
    restoreCode: `DD-${randomId(4)}-${randomId(4)}`,
  };
  state.screen = "home";
  saveState();
  showToast("تم إنشاء الحساب. الساحة جاهزة.");
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
  return roomRuntime.room?.hostId === getAppClientId();
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
    avatarId: player.avatarId || avatar.id,
    bladeId: player.bladeId || "ignite",
    skinId: player.skinId || skin.id,
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
    pushRoomLog(duel, `${attacker.name} اندفع ليجهز الهجمة التالية.`, "dash");
    return;
  }

  const evaded = defender.evadeUntil > timestamp;
  if (evaded) {
    defender.evadeUntil = 0;
    pushRoomLog(duel, `${defender.name} تفادى هجمة ${attacker.name}.`, "evade");
    return;
  }

  const damage = damageRoll(action.type, actorBladeId);
  defender.hp = Math.max(0, defender.hp - damage);
  attacker.charge = Math.min(100, attacker.charge + chargeGain(action.type, actorBladeId));
  pushRoomLog(
    duel,
    `${attacker.name} أصاب الخصم بـ ${damage} عبر ${action.type === "special" ? "الضربة الخاصة" : "ضربة سريعة"}.`,
    action.type === "special" ? "special" : "hit",
  );

  if (defender.hp <= 0) {
    finalizeSimulatedDuel(duel);
  }
}

function applyRoomFxFromLatestAction(room) {
  const actions = Object.entries(room?.duel?.actions || {});
  if (actions.length === 0) {
    return false;
  }

  const sortedActions = actions.sort((left, right) => left[0].localeCompare(right[0]));
  const latestPair = sortedActions[sortedActions.length - 1];
  if (!latestPair) {
    return false;
  }
  const [latestId, latestAction] = latestPair;
  if (latestId === roomRuntime.latestActionId) {
    return false;
  }

  roomRuntime.latestActionId = latestId;
  const isPlayer = latestAction.actorId === getAppClientId();
  roomRuntime.latestActionType = latestAction.type;
  roomRuntime.latestActorSide = isPlayer ? "player" : "rival";
  roomRuntime.fx = {
    player: isPlayer
      ? latestAction.type === "dash"
        ? "evade"
        : latestAction.type
      : latestAction.type === "dash"
        ? ""
        : "hit",
    rival: isPlayer
      ? latestAction.type === "dash"
        ? ""
        : "hit"
      : latestAction.type === "dash"
        ? "evade"
        : latestAction.type,
    until: Date.now() + 260,
  };

  const tone = latestAction.type === "special" ? "special" : latestAction.type === "dash" ? "dash" : "hit";
  if (latestAction.type === "special") {
    triggerScreenShake(10);
  } else if (latestAction.type === "attack") {
    triggerScreenShake(6);
  }
  playSfx(tone);
  return true;
}

function buildRoomDuel(room) {
  if (!room?.duel) {
    return null;
  }

  const myId = getAppClientId();
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
        text: `${me.name} و${rival.name} دخلا غرفة ${room.code}.`,
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
  showToast(duel.winner === "player" ? "فزت بمواجهة الغرفة وتمت إضافة المكافآت." : "خسرت مواجهة الغرفة وتمت إضافة المكافآت.");
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

  if (nextHostId === getAppClientId()) {
    const api = await loadFirebaseApi();
    await api.setRoomHost(room.code, nextHostId);
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
  roomRuntime.latestActionType = "";
  roomRuntime.latestActorSide = "";
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

async function attachRoomSubscription(code) {
  detachRoomSubscription();
  roomRuntime.currentCode = code;
  const api = await loadFirebaseApi();
  roomRuntime.roomUnsubscribe = api.subscribeRoom(code, async (room) => {
    const previousDuel = state.duel?.mode === "room" ? cloneValue(state.duel) : null;
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
    const actionWasNew = applyRoomFxFromLatestAction(room);

    const roomDuel = buildRoomDuel(room);
    if (roomDuel) {
      state.duel = roomDuel;
      if (previousDuel && actionWasNew) {
        const playerDelta = Math.max(0, previousDuel.player.hp - roomDuel.player.hp);
        const rivalDelta = Math.max(0, previousDuel.rival.hp - roomDuel.rival.hp);
        const actorKey = roomRuntime.latestActorSide || "player";
        const defenderKey = actorKey === "player" ? "rival" : "player";
        const nextFx = {
          player: "",
          rival: "",
          until: Date.now() + 260,
        };

        if (roomRuntime.latestActionType === "dash") {
          nextFx[actorKey] = "evade";
          triggerCombatMotion(actorKey, defenderKey, "dash");
        } else if (playerDelta > 0 || rivalDelta > 0) {
          const damage = actorKey === "player" ? rivalDelta : playerDelta;
          nextFx[actorKey] = roomRuntime.latestActionType || "attack";
          nextFx[defenderKey] = "hit";
          triggerCombatMotion(actorKey, defenderKey, roomRuntime.latestActionType || "attack", false, damage);
          triggerScreenShake((roomRuntime.latestActionType || "attack") === "special" ? 10 : 6);
        } else if (roomRuntime.latestActionType) {
          nextFx[actorKey] = roomRuntime.latestActionType;
          nextFx[defenderKey] = "evade";
          triggerCombatMotion(actorKey, defenderKey, roomRuntime.latestActionType, true);
        }

        roomRuntime.fx = nextFx;
      }
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
    const api = await loadFirebaseApi();
    await api.syncPlayerProfile(state.roomCodeActive, state.profile);
  } catch {
    showToast("فشل تحديث بيانات اللاعب داخل الغرفة.");
  }
}

function createDuel(mode = "practice", rivalName = "روغ فلوكس") {
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
      avatarId: state.profile.avatarId,
      bladeId: state.profile.bladeId,
      skinId: state.profile.skinId,
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
      avatarId: "rival",
      bladeId: "ignite",
      skinId: rivalSkin.id,
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
        text: `${state.profile.name} دخل الساحة. ${rivalName} جاهز للمواجهة.`,
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
  return Math.max(0, Math.ceil((state.duel.endsAt - now()) / 1000));
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

function triggerCombatMotion(attackerKey, defenderKey, action, evaded = false, damage = 0) {
  if (!state.duel) {
    return;
  }

  if (action === "dash") {
    markFlash(attackerKey, "evade");
    showFloatingText(attackerKey === "player" ? 28 : 72, 42, "دفاع", "evade");
    return;
  }

  markFlash(attackerKey, action);

  if (evaded) {
    markFlash(defenderKey, "evade");
    showFloatingText(defenderKey === "player" ? 28 : 72, 40, "تفادي", "evade");
    return;
  }

  markFlash(defenderKey, "hit");
  showFloatingText(defenderKey === "player" ? 28 : 72, 36, `-${damage}`, "damage");
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
    pushLog(`${state.profile.name} حسم المعركة وسيطر على الساحة.`, "win");
    addProgress("win");
    playSfx("win");
  } else {
    pushLog(`${duel.rival.name} خطف المباراة في اللحظة الأخيرة.`, "loss");
    addProgress("loss");
    playSfx("loss");
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
    pushLog(`${attacker.name} اندفع بسرعة وجهز هجمة مرتدة.`, "dash");
    triggerCombatMotion(attackerKey, defenderKey, action);
    playSfx("dash");
    render();
    return;
  }

  const evaded = defender.evadeUntil > timestamp;
  if (evaded) {
    defender.evadeUntil = 0;
    pushLog(`${defender.name} تفادى هجمة ${attacker.name}.`, "evade");
    triggerCombatMotion(attackerKey, defenderKey, action, true);
    playTone("miss");
  } else {
    const damage = damageRoll(action, actorBladeId);
    defender.hp = Math.max(0, defender.hp - damage);
    attacker.charge =
      action === "special"
        ? attacker.charge
        : Math.min(100, attacker.charge + chargeGain(action, actorBladeId));
    triggerCombatMotion(attackerKey, defenderKey, action, false, damage);
    triggerScreenShake(action === "special" ? 10 : 6);
    pushLog(
      `${attacker.name} وجه ${action === "special" ? "الضربة الخاصة" : "ضربة مباشرة"} بقيمة ${damage}.`,
      action === "special" ? "special" : "hit",
    );
    playSfx(action === "special" ? "special" : "hit");
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
  state.duel = createDuel("practice", "روغ فلوكس");
  render();
  runLoop();
}

async function openRoom() {
  if (state.roomCodeActive) {
    await leaveActiveRoom();
  }

  let lastError = null;
  let api;

  try {
    api = await loadFirebaseApi();
  } catch (error) {
    showToast("فشل تحميل Firebase.");
    return false;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomId();
    try {
      const code = await api.createRoom(state.profile, candidate);
      setRoomInvite(code);
      await attachRoomSubscription(code);
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

  showToast(lastError?.message || "فشل إنشاء الغرفة.");
  return false;
}

async function joinRoom() {
  const code = state.roomCodeDraft.trim().toUpperCase();
  if (code.length < 4) {
    showToast("أدخل كود غرفة صحيح.");
    return false;
  }

  if (state.roomCodeActive && state.roomCodeActive !== code) {
    await leaveActiveRoom();
  }

  try {
    const api = await loadFirebaseApi();
    const joinedCode = await api.joinRoom(state.profile, code);
    setRoomInvite(joinedCode);
    await attachRoomSubscription(joinedCode);
    state.screen = "rooms";
    saveState();
    render();
    return true;
  } catch (error) {
    showToast(error?.message || "تعذر الانضمام إلى الغرفة.");
    return false;
  }
}

async function leaveActiveRoom() {
  if (!state.roomCodeActive) {
    return;
  }

  try {
    const api = await loadFirebaseApi();
    await api.leaveRoom(state.roomCodeActive);
  } catch {
    showToast("تعذر مغادرة الغرفة.");
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
    const api = await loadFirebaseApi();
    await api.startRoomDuel(state.roomCodeActive);
    showToast("تم بدء المواجهة الحية.");
  } catch (error) {
    showToast(error?.message || "تعذر بدء المباراة.");
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
    const api = await loadFirebaseApi();
    await api.sendRoomAction(state.roomCodeActive, action);
  } catch {
    showToast("فشل مزامنة الحركة.");
  }
}

function copyRoomLink() {
  if (!state.roomInviteLink) {
    return;
  }
  navigator.clipboard
    .writeText(state.roomInviteLink)
    .then(() => showToast("تم نسخ رابط الدعوة."))
    .catch(() => showToast("المتصفح منع النسخ التلقائي."));
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

const LABELS = {
  avatars: {
    nova: "نوفا",
    flux: "فلوكس",
    warden: "واردن",
    ember: "إمبر",
    arc: "آرك",
    drift: "دريفت",
  },
  blades: {
    ignite: "سيف الشعلة",
    riptide: "ناب الموج",
    comet: "نواة المذنب",
    halo: "حافة الهالة",
  },
  skins: {
    "crimson-rush": "اندفاع قرمزي",
    "jade-circuit": "دارة اليشم",
    "solar-drive": "نبض شمسي",
    "glacier-loop": "حلقة جليدية",
    "night-shift": "وردية الليل",
  },
};

function localizedAvatar(id) {
  return LABELS.avatars[id] || avatarById(id).name;
}

function localizedBlade(id) {
  return LABELS.blades[id] || bladeById(id).name;
}

function localizedSkin(id) {
  return LABELS.skins[id] || skinById(id).name;
}

function renderSplash() {
  return `
    <section class="splash-screen ${bootRuntime.exiting ? "is-exit" : ""}" style="background-image:url('${ASSET_URLS.backgrounds.splash}')">
      <div class="splash-glass">
        <img class="splash-logo" src="${ASSET_URLS.branding.logo}" alt="Duel Dash" />
        <div class="eyebrow">تجهيز موارد اللعبة</div>
        <h1 class="display-title">Duel Dash</h1>
        <p class="subtitle">تحميل الواجهة، الصور، وتجهيز اتصال القتال قبل الدخول إلى الساحة.</p>
        <div class="loading-bar"><span style="width:${bootRuntime.progress}%;"></span></div>
        <div class="loading-meta">
          <span>تحميل</span>
          <span>${bootRuntime.progress}%</span>
        </div>
      </div>
    </section>
  `;
}

function actionButton(action, detail) {
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
  const disabled = !canUseAction(fighter, action);

  return `
    <button class="ability-card ${action}" data-action="${action}" ${disabled ? "disabled" : ""}>
      <span class="ability-core">
        <span class="ability-icon-wrap">
          <span class="ability-svg-icon">${renderAbilityGlyph(action)}</span>
          <span class="cooldown-mask" style="height:${percent}%;"></span>
        </span>
      </span>
      <strong>${detail.title}</strong>
      <small>${detail.tag}</small>
    </button>
  `;
}

function renderOnboarding() {
  return `
    <section class="game-screen stack reveal">
      <article class="hero-panel" style="background-image:url('${ASSET_URLS.backgrounds.lobby}')">
        <img class="hero-logo" src="${ASSET_URLS.branding.logo}" alt="Duel Dash" />
        <div class="eyebrow">واجهة عربية · PWA</div>
        <h1 class="display-title">جهّز بطلك</h1>
        <p class="subtitle">اختر شخصية وسلاحًا بصورة فعلية، ثم ادخل مباشرة إلى لوبي المواجهة.</p>
      </article>

      <article class="panel shell-form">
        <div class="panel-head">
          <div>
            <h2>تأسيس الحساب</h2>
            <p>لا يوجد تسجيل طويل. اسم وصورة وسلاح، ثم تبدأ اللعب فورًا.</p>
          </div>
          <span class="panel-pill">الخطوة 1</span>
        </div>
        <form id="onboarding-form" class="stack">
          <label class="stack">
            <span class="field-label">اسم اللاعب</span>
            <input type="text" name="name" maxlength="16" placeholder="اكتب اسمك داخل الساحة" required />
          </label>

          <div class="stack">
            <span class="field-label">اختر الشخصية</span>
            <div class="media-grid media-grid-avatars">
              ${avatars
                .map(
                  (avatar, index) => `
                    <button type="button" class="media-card ${index === 0 ? "is-selected" : ""}" data-avatar="${avatar.id}">
                      <img src="${getFighterImage(avatar.id)}" alt="${localizedAvatar(avatar.id)}" />
                      <strong>${localizedAvatar(avatar.id)}</strong>
                      <span>أسلوب قتال مختلف</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <input type="hidden" name="avatarId" value="${avatars[0].id}" />
          </div>

          <div class="stack">
            <span class="field-label">اختر السلاح</span>
            <div class="media-grid media-grid-weapons">
              ${blades
                .map(
                  (blade, index) => `
                    <button type="button" class="media-card weapon-card ${index === 0 ? "is-selected" : ""}" data-blade="${blade.id}">
                      <img src="${getBladeImage(blade.id)}" alt="${localizedBlade(blade.id)}" />
                      <strong>${localizedBlade(blade.id)}</strong>
                      <span>${blade.bonus}</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <input type="hidden" name="bladeId" value="${blades[0].id}" />
          </div>

          <button class="btn btn-play" type="submit">ادخل اللوبي</button>
        </form>
      </article>
    </section>
  `;
}

function fighterImageFor(fighter, fallbackAvatar = "rival") {
  return getFighterImage(fighter.avatarId || fallbackAvatar);
}

function bladeImageFor(fighter, fallbackBlade = "ignite") {
  return getBladeImage(fighter.bladeId || fallbackBlade);
}

function renderFloatingTexts() {
  return uiRuntime.floatingTexts
    .map((item) => {
      return `
        <span class="floating-text ${item.variant}" style="left:${item.x}%; top:${item.y}%;">
          ${item.text}
        </span>
      `;
    })
    .join("");
}

function localizedTone(tone) {
  const labels = {
    start: "بداية",
    info: "معلومة",
    hit: "ضربة",
    special: "خاص",
    dash: "دفاع",
    evade: "تفادٍ",
    win: "فوز",
    loss: "خسارة",
  };
  return labels[tone] || tone;
}

function renderAvatarBadge(avatar) {
  return `
    <svg viewBox="0 0 88 88" class="avatar-badge-svg" aria-hidden="true">
      <defs>
        <linearGradient id="avatar-${avatar.id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${avatar.gradient.match(/#(?:[0-9a-fA-F]{3}){1,2}/g)?.[0] || "#ff7c52"}" />
          <stop offset="100%" stop-color="${avatar.gradient.match(/#(?:[0-9a-fA-F]{3}){1,2}/g)?.[1] || "#ffd372"}" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="78" height="78" rx="24" fill="#0a101b" />
      <rect x="10" y="10" width="68" height="68" rx="20" fill="url(#avatar-${avatar.id})" />
      <circle cx="44" cy="30" r="14" fill="rgba(255,255,255,.2)" />
      <path d="M25 66c3-12 12-18 19-18s16 6 19 18" fill="rgba(11,16,27,.24)" />
      <text x="44" y="56" text-anchor="middle" font-size="24" font-weight="800" fill="#fff6eb" font-family="Arial">${avatar.sigil}</text>
    </svg>
  `;
}

function renderCoinIcon() {
  return `
    <svg viewBox="0 0 32 32" class="currency-icon coin-icon" aria-hidden="true">
      <defs>
        <radialGradient id="coin-core" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fff5be" />
          <stop offset="60%" stop-color="#ffd669" />
          <stop offset="100%" stop-color="#ff9f3f" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#coin-core)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="rgba(120,68,10,.4)" stroke-width="2" />
      <path d="M12 16h8M16 12v8" stroke="rgba(120,68,10,.55)" stroke-width="2.2" stroke-linecap="round" />
    </svg>
  `;
}

function renderGemIcon() {
  return `
    <svg viewBox="0 0 32 32" class="currency-icon gem-icon" aria-hidden="true">
      <defs>
        <linearGradient id="gem-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#cbf9ff" />
          <stop offset="50%" stop-color="#65cfff" />
          <stop offset="100%" stop-color="#4f79ff" />
        </linearGradient>
      </defs>
      <path d="M16 3l10 8-10 18L6 11 16 3Z" fill="url(#gem-core)" />
      <path d="M16 3v26M6 11h20" stroke="rgba(255,255,255,.42)" stroke-width="1.5" />
    </svg>
  `;
}

function gradientColors(gradient, fallback = ["#ff7c52", "#ffd372"]) {
  const matches = String(gradient || "").match(/#(?:[0-9a-fA-F]{3}){1,2}/g);
  if (!matches || matches.length < 2) {
    return fallback;
  }
  return [matches[0], matches[1]];
}

function renderCombatantSvg(fighter, side) {
  const [primary, secondary] = gradientColors(fighter.gradient, side === "player" ? ["#ff7c52", "#ffd372"] : ["#59d3ff", "#7b7dff"]);
  return `
    <svg viewBox="0 0 220 320" class="combatant-svg" aria-hidden="true">
      <defs>
        <linearGradient id="body-${side}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
        <linearGradient id="visor-${side}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#cbf9ff" />
          <stop offset="100%" stop-color="#5de3ff" />
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="300" rx="58" ry="16" fill="rgba(0,0,0,.28)" />
      <g>
        <path d="M110 24l38 22v40l-38 18-38-18V46z" fill="url(#body-${side})" stroke="rgba(255,255,255,.18)" stroke-width="4" />
        <rect x="78" y="58" width="64" height="16" rx="8" fill="url(#visor-${side})" opacity=".92" />
        <path d="M86 104h48l24 44-18 70h-16l-6-52h-16l-6 52H80l-18-70z" fill="url(#body-${side})" stroke="rgba(255,255,255,.12)" stroke-width="4" />
        <path d="M76 114l-26 34 20 14 26-30zM144 114l26 34-20 14-26-30z" fill="${secondary}" opacity=".95" />
        <path d="M82 220l-14 62h24l14-54zM138 220l14 62h-24l-14-54z" fill="${primary}" opacity=".92" />
        <path d="M158 142l34 60-18 8-36-56z" fill="#d6f8ff" opacity=".9" />
        <circle cx="110" cy="124" r="8" fill="#fff7e8" opacity=".85" />
      </g>
    </svg>
  `;
}

function renderAbilityGlyph(action) {
  const icons = {
    attack: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M29 6l13 13-4 4-5-5-12 12-3 10 10-3 12-12-5-5 4-4 7 7-15 15-18 6 6-18z" fill="#fff7e8" />
      </svg>
    `,
    dash: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6l14 6v10c0 8-5 14-14 20C15 36 10 30 10 22V12z" fill="#fff7e8" />
        <path d="M24 14l4 8h8l-6 5 2 8-8-5-8 5 2-8-6-5h8z" fill="rgba(11,16,27,.42)" />
      </svg>
    `,
    special: `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M26 4L10 26h10l-2 18 20-26H28z" fill="#fff7e8" />
      </svg>
    `,
  };

  return icons[action] || icons.attack;
}

function renderHome() {
  const profile = state.profile;
  if (!profile) {
    return renderOnboarding();
  }
  const avatar = currentAvatar();
  const skin = currentSkin();
  const blade = currentBlade();
  const missions = dailyMissions();
  const unlockedSkinCount = availableSkins().length;

  return `
    <section class="game-screen stack reveal">
      <article class="lobby-banner panel">
        <div class="lobby-banner-main">
          <div class="lobby-avatar-badge">
            ${renderAvatarBadge(avatar)}
          </div>
          <div class="lobby-banner-copy">
            <span class="eyebrow">ملف اللاعب</span>
            <strong>${profile.name}</strong>
            <span>المستوى ${profile.level} · ${localizedAvatar(avatar.id)}</span>
          </div>
        </div>

        <div class="lobby-currency-bar">
          <div class="currency-chip coin">
            ${renderCoinIcon()}
            <div>
              <span>Coins</span>
              <strong>${profile.coins}</strong>
            </div>
          </div>
          <div class="currency-chip gem">
            ${renderGemIcon()}
            <div>
              <span>Gems</span>
              <strong>${profile.gems}</strong>
            </div>
          </div>
        </div>
      </article>

      <article class="hero-panel lobby-hero" style="background-image:url('${ASSET_URLS.backgrounds.lobby}')">
        <div class="hero-topline">
          <span class="eyebrow">اللوبي الرئيسي</span>
          <span class="hero-status ${roomRuntime.connected ? "online" : ""}">
            ${roomRuntime.connected ? "متصل" : "جارٍ الاتصال"}
          </span>
        </div>

        <div class="hero-player-card">
          <div class="hero-player-media">
            <img class="hero-fighter" src="${fighterImageFor({ avatarId: avatar.id }, avatar.id)}" alt="${localizedAvatar(avatar.id)}" />
            <img class="hero-weapon" src="${getBladeImage(blade.id)}" alt="${localizedBlade(blade.id)}" />
          </div>

          <div class="hero-player-copy">
            <div class="profile-strip">
              <span class="panel-pill">المستوى ${profile.level}</span>
              <span class="coin-pill">${localizedBlade(blade.id)}</span>
            </div>
            <h1 class="display-title">جاهز للمواجهة يا ${profile.name}</h1>
            <p class="subtitle">واجهة عربية بالكامل، إحساس قريب من التطبيق المثبت، وتجهيزات مرئية جاهزة للانتقال إلى القتال.</p>

            <div class="xp-card">
              <div class="xp-card-head">
                <strong>شريط التطور</strong>
                <span>${profile.xp} / ${nextLevelXp(profile.level)} XP</span>
              </div>
              <div class="xp-track"><div class="xp-fill" style="width:${levelProgress()}%;"></div></div>
            </div>
          </div>
        </div>
      </article>

      <article class="panel player-summary">
        <div class="panel-head">
          <div>
            <h2>بطاقة اللاعب</h2>
            <p>اسم، مستوى، معدل الفوز، وكود استرجاع محفوظ داخل تجربة تشبه واجهات ألعاب الموبايل.</p>
          </div>
          <button class="panel-pill" data-open-overlay="locker">الخزنة</button>
        </div>

        <div class="player-card-grid">
          <div class="player-card-large">
            <div class="player-card-header">
              <img class="player-avatar" src="${fighterImageFor({ avatarId: avatar.id }, avatar.id)}" alt="${localizedAvatar(avatar.id)}" />
              <div>
                <strong>${profile.name}</strong>
                <span>${localizedAvatar(avatar.id)} · ${localizedBlade(blade.id)}</span>
              </div>
            </div>

            <div class="player-restore">
              <span>كود الاسترجاع</span>
              <strong>${profile.restoreCode}</strong>
            </div>
          </div>

          <div class="mini-stat">
            <strong>${profile.wins}</strong>
            <span>انتصارات</span>
          </div>
          <div class="mini-stat">
            <strong>${profile.losses}</strong>
            <span>هزائم</span>
          </div>
          <div class="mini-stat">
            <strong>${unlockedSkinCount}</strong>
            <span>سكنات مفتوحة</span>
          </div>
        </div>
      </article>

      <article class="panel loadout-panel">
        <div class="panel-head">
          <div>
            <h2>التجهيزات الحالية</h2>
            <p>البطل، السلاح، والسكن الحالي مع صور جاهزة للاستبدال لاحقًا بروابط Cloudinary.</p>
          </div>
          <span class="panel-pill">Inventory</span>
        </div>

        <div class="locker-preview-grid">
          <div class="inventory-tile featured">
            <img src="${fighterImageFor({ avatarId: avatar.id }, avatar.id)}" alt="${localizedAvatar(avatar.id)}" />
            <strong>${localizedAvatar(avatar.id)}</strong>
            <span>الشخصية الأساسية</span>
          </div>
          <div class="inventory-tile">
            <img src="${getSkinImage(skin.id)}" alt="${localizedSkin(skin.id)}" />
            <strong>${localizedSkin(skin.id)}</strong>
            <span>السكن الحالي</span>
          </div>
          <div class="inventory-tile">
            <img src="${getBladeImage(blade.id)}" alt="${localizedBlade(blade.id)}" />
            <strong>${localizedBlade(blade.id)}</strong>
            <span>${blade.bonus}</span>
          </div>
        </div>
      </article>

      <article class="panel mission-panel">
        <div class="panel-head">
          <div>
            <h2>مهام اليوم</h2>
            <p>لفات تقدم بسيطة تبقي الحساب حيًا بدون تعقيد تسجيل أو باك إند إضافي.</p>
          </div>
          <span class="panel-pill">${missions.length} مهام</span>
        </div>

        <div class="mission-grid">
          ${missions
            .map(
              (mission) => `
                <div class="mission-card">
                  <strong>${mission.title}</strong>
                  <span>${mission.reward}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>

      <div class="home-cta-wrap">
        <button class="btn btn-play btn-play-xl" data-nav="rooms">ابحث عن خصم</button>
      </div>
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

function renderRoomsGame() {
  const players = roomPlayers();
  const hasActiveRoom = Boolean(roomRuntime.room);
  const roomStatus =
    state.duel?.mode === "room" && state.duel.roomCode === state.roomCodeActive
      ? state.duel.status
      : roomRuntime.room?.duel?.status || roomRuntime.room?.status || "idle";
  const liveDuelReady = players.length === 2;
  const canStart = hasActiveRoom && isRoomHost() && liveDuelReady;

  return `
    <section class="game-screen stack reveal">
      <article class="hero-panel room-hero" style="background-image:url('${ASSET_URLS.backgrounds.room}')">
        <div class="hero-topline">
          <span class="eyebrow">غرفة اللعب</span>
          <span class="hero-status ${roomRuntime.connected ? "online" : ""}">
            ${roomRuntime.connected ? "Firebase متصل" : "انتظار قاعدة البيانات"}
          </span>
        </div>
        <h1 class="display-title">لوبي الدعوة والمواجهة</h1>
        <p class="subtitle">كوّد سريع، دخول من جهازين، ثم بدء الجولة الحية من نفس الغرفة بدون أي صفحة ويب تقليدية.</p>
      </article>

      <article class="panel room-panel">
        <div class="panel-head">
          <div>
            <h2>الغرفة الحالية</h2>
            <p>أنشئ روم جديد أو شارك الكود مع صديقك ثم ابدأ المواجهة المباشرة.</p>
          </div>
          <button class="panel-pill" data-room="generate">كود جديد</button>
        </div>

        <div class="room-code-card">
          <span>Room Code</span>
          <strong>${state.roomCodeActive || "------"}</strong>
          <small>${hasActiveRoom ? `الحالة: ${roomStatus}` : "لا توجد غرفة مرتبطة حاليًا"}</small>
        </div>

        <div class="room-action-grid">
          <button class="btn btn-primary" data-room="copy" ${state.roomInviteLink ? "" : "disabled"}>نسخ رابط الدعوة</button>
          <button class="btn btn-accent" data-room="start-live" ${canStart ? "" : "disabled"}>
            ${roomStatus === "live" ? "المعركة بدأت" : isRoomHost() ? "ابدأ المباراة الحية" : "المضيف يبدأ المباراة"}
          </button>
          <button class="btn btn-secondary" data-room="open-duel" ${roomStatus === "live" || roomStatus === "done" ? "" : "disabled"}>
            فتح ساحة القتال
          </button>
          <button class="btn btn-secondary" data-room="leave" ${hasActiveRoom ? "" : "disabled"}>مغادرة الغرفة</button>
        </div>
      </article>

      <article class="panel room-panel">
        <div class="panel-head">
          <div>
            <h2>انضمام سريع</h2>
            <p>الصق الكود أو استخدم رابط الدعوة. بمجرد دخول لاعبين اثنين تصبح الغرفة جاهزة.</p>
          </div>
          <span class="panel-pill">${players.length}/2</span>
        </div>

        <label class="stack">
          <span class="field-label">كود الغرفة</span>
          <input
            id="room-code-input"
            type="text"
            maxlength="8"
            value="${state.roomCodeDraft}"
            placeholder="ABCD12"
          />
        </label>
        <button class="btn btn-secondary" data-room="join">انضم الآن</button>

        <div class="room-players-grid">
          ${
            players.length
              ? players
                  .map((player) => {
                    const isHost = player.id === roomRuntime.room?.hostId;
                    return `
                      <div class="room-player-card">
                        <img src="${getFighterImage(player.avatarId)}" alt="${player.name}" />
                        <div>
                          <strong>${player.name}</strong>
                          <span>${localizedBlade(player.bladeId)} · مستوى ${player.level || 1}</span>
                        </div>
                        ${isHost ? `<em>المضيف</em>` : ""}
                      </div>
                    `;
                  })
                  .join("")
              : `
                <div class="empty-room-state">
                  <strong>بانتظار اللاعبين</strong>
                  <span>عندما يدخل لاعبان، ستظهر بطاقات الشخصيات هنا مباشرة.</span>
                </div>
              `
          }
        </div>
      </article>
    </section>
  `;
}

function renderDuelGame() {
  const duel = state.duel;
  if (!duel) {
    return "";
  }

  const timeLeft = duelTimeLeft();
  const playerHp = Math.max(0, Math.round(duel.player.hp));
  const rivalHp = Math.max(0, Math.round(duel.rival.hp));
  const resultText =
    duel.status === "done"
      ? duel.winner === "player"
        ? "انتصار"
        : "هزيمة"
      : duel.mode === "practice"
        ? "تجريب سريع"
        : duel.roomCode || "مبارزة حية";

  return `
    <section class="game-screen duel-screen reveal">
      <article class="battle-shell ${uiRuntime.shakeUntil > Date.now() ? "is-shaking" : ""}" style="background-image:url('${ASSET_URLS.backgrounds.arena}')">
        <div class="battle-hud">
          <div class="fighter-hud player ${duel.player.flash}">
            <div class="fighter-hud-head">
              <img class="fighter-portrait" src="${fighterImageFor(duel.player, state.profile?.avatarId || "nova")}" alt="${duel.player.name}" />
              <div>
                <strong>${duel.player.name}</strong>
                <span>${playerHp} / 100 HP</span>
              </div>
            </div>
            <div class="hp-track game"><div class="hp-fill" style="width:${playerHp}%;"></div></div>
            <div class="charge-track"><div class="charge-fill" style="width:${duel.player.charge}%;"></div></div>
          </div>

          <div class="battle-center-hud">
            <span class="timer-badge">${timeLeft}</span>
            <strong>${resultText}</strong>
            <small>${duel.mode === "practice" ? "مواجهة تدريب" : "مواجهة أونلاين"}</small>
          </div>

          <div class="fighter-hud rival ${duel.rival.flash}">
            <div class="fighter-hud-head">
              <img class="fighter-portrait" src="${fighterImageFor(duel.rival, "rival")}" alt="${duel.rival.name}" />
              <div>
                <strong>${duel.rival.name}</strong>
                <span>${rivalHp} / 100 HP</span>
              </div>
            </div>
            <div class="hp-track game rival"><div class="hp-fill" style="width:${rivalHp}%;"></div></div>
            <div class="charge-track rival"><div class="charge-fill" style="width:${duel.rival.charge}%;"></div></div>
          </div>
        </div>

        <div class="arena-stage">
          <div class="arena-fighter arena-player ${duel.player.flash}">
            <img class="arena-character" src="${fighterImageFor(duel.player, state.profile?.avatarId || "nova")}" alt="${duel.player.name}" />
            <img class="arena-weapon" src="${bladeImageFor(duel.player, state.profile?.bladeId || "ignite")}" alt="weapon" />
          </div>

          <div class="arena-vfx-layer">
            ${renderFloatingTexts()}
          </div>

          <div class="arena-fighter arena-rival ${duel.rival.flash}">
            <img class="arena-character" src="${fighterImageFor(duel.rival, "rival")}" alt="${duel.rival.name}" />
            <img class="arena-weapon" src="${bladeImageFor(duel.rival, "ignite")}" alt="weapon" />
          </div>
        </div>

        <div class="battle-controls">
          ${actionButton("attack", {
            title: "ضربة سريعة",
            copy: "ضربة مباشرة تبني الشحن بسرعة.",
            tag: "Tap",
          })}
          ${actionButton("dash", {
            title: "اندفاعة",
            copy: "تفادٍ قصير مع فرصة رد هجومي.",
            tag: "Swipe",
          })}
          ${actionButton("special", {
            title: "الضربة الخاصة",
            copy: duel.player.charge >= 100 ? "مجهزة الآن لإنهاء الجولة." : "اشحن العداد حتى 100%.",
            tag: "Hold",
          })}
        </div>
      </article>

      <article class="panel battle-log-panel">
        <div class="panel-head">
          <div>
            <h2>سجل القتال</h2>
            <p>${duel.mode === "practice" ? "هذه المواجهة تعمل محليًا كتدريب سريع." : "هذا السجل ناتج عن أحداث الغرفة المتزامنة عبر Firebase."}</p>
          </div>
          <button class="panel-pill" data-duel="${duel.mode === "practice" ? "restart" : "rooms"}">
            ${duel.mode === "practice" ? "إعادة اللعب" : "العودة للغرفة"}
          </button>
        </div>

        <div class="combat-log-grid">
          ${duel.log
            .map(
              (entry) => `
                <div class="combat-log-item ${entry.tone}">
                  <strong>${localizedTone(entry.tone)}</strong>
                  <span>${entry.text}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function renderDuelGame() {
  const duel = state.duel;
  if (!duel) {
    return "";
  }

  const timeLeft = duelTimeLeft();
  const playerHp = Math.max(0, Math.round(duel.player.hp));
  const rivalHp = Math.max(0, Math.round(duel.rival.hp));
  const resultText =
    duel.status === "done"
      ? duel.winner === "player"
        ? "انتصار"
        : "هزيمة"
      : duel.mode === "practice"
        ? "تجريب سريع"
        : duel.roomCode || "مبارزة حية";

  return `
    <section class="game-screen duel-screen reveal">
      <article class="battle-shell ${uiRuntime.shakeUntil > Date.now() ? "is-shaking" : ""}" style="--shake-intensity:${uiRuntime.shakeIntensity}px;">
        <div class="battle-backdrop">
          <span class="battle-layer layer-far"></span>
          <span class="battle-layer layer-mid"></span>
          <span class="battle-layer layer-neon"></span>
        </div>

        <div class="battle-hud">
          <div class="battle-health-card player ${duel.player.flash}">
            <div class="health-meta">
              <strong>${duel.player.name}</strong>
              <span>${playerHp} / 100 HP</span>
            </div>
            <div class="hp-frame">
              <div class="hp-track game player">
                <div class="hp-fill" style="width:${playerHp}%;"></div>
              </div>
            </div>
          </div>

          <div class="battle-center-hud">
            <span class="timer-badge">${timeLeft}</span>
            <strong>${resultText}</strong>
            <small>${duel.mode === "practice" ? "مواجهة تدريب" : "مواجهة أونلاين"}</small>
          </div>

          <div class="battle-health-card rival ${duel.rival.flash}">
            <div class="health-meta">
              <strong>${duel.rival.name}</strong>
              <span>${rivalHp} / 100 HP</span>
            </div>
            <div class="hp-frame">
              <div class="hp-track game rival">
                <div class="hp-fill" style="width:${rivalHp}%;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="arena-stage">
          <div class="arena-vfx-layer">
            ${renderFloatingTexts()}
          </div>
          <div class="arena-floor"></div>

          <div class="arena-fighter arena-player ${duel.player.flash}">
            <span class="shield-effect"></span>
            <div class="combatant idle">
              ${renderCombatantSvg(duel.player, "player")}
            </div>
            <div class="fighter-charge player">
              <span>شحن</span>
              <div class="charge-track"><div class="charge-fill" style="width:${duel.player.charge}%;"></div></div>
            </div>
          </div>

          <div class="arena-fighter arena-rival ${duel.rival.flash}">
            <span class="shield-effect"></span>
            <div class="combatant idle rival">
              ${renderCombatantSvg(duel.rival, "rival")}
            </div>
            <div class="fighter-charge rival">
              <span>شحن</span>
              <div class="charge-track rival"><div class="charge-fill" style="width:${duel.rival.charge}%;"></div></div>
            </div>
          </div>
        </div>

        <div class="battle-controls">
          ${actionButton("attack", {
            title: "ضربة",
            tag: "هجوم",
          })}
          ${actionButton("dash", {
            title: "تفادٍ",
            tag: "دفاع",
          })}
          ${actionButton("special", {
            title: "طاقة",
            tag: "خاص",
          })}
        </div>

        <div class="battle-feed">
          <button class="panel-pill battle-exit" data-duel="${duel.mode === "practice" ? "restart" : "rooms"}">
            ${duel.mode === "practice" ? "إعادة اللعب" : "العودة للغرفة"}
          </button>
          <div class="battle-feed-list">
            ${duel.log
              .slice(0, 3)
              .map(
                (entry) => `
                  <div class="combat-log-item ${entry.tone}">
                    <strong>${localizedTone(entry.tone)}</strong>
                    <span>${entry.text}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </article>
    </section>
  `;
}

function lockerOverlayGame() {
  const profile = state.profile;
  const selectedSkin = currentSkin();
  const selectedBlade = currentBlade();

  return `
    <div class="overlay" data-close-overlay="true">
      <div class="sheet sheet-locker" onclick="event.stopPropagation()">
        <div class="sheet-head">
          <div>
            <h2>الخزنة</h2>
            <p>اختيار السكن والسلاح من واجهة شبكية مثل ألعاب الموبايل.</p>
          </div>
          <button class="panel-pill" data-close-overlay="true">إغلاق</button>
        </div>

        <div class="sheet-section">
          <div class="section-headline">
            <strong>السكنات</strong>
            <span>${availableSkins().length}/${skins.length}</span>
          </div>
          <div class="media-grid media-grid-locker">
            ${skins
              .map((skin) => {
                const unlocked = profile.unlockedSkins.includes(skin.id);
                const selected = selectedSkin.id === skin.id;
                return `
                  <button
                    class="media-card locker-card ${selected ? "is-selected" : ""}"
                    data-skin="${skin.id}"
                    ${unlocked ? "" : "disabled"}
                  >
                    <img src="${getSkinImage(skin.id)}" alt="${localizedSkin(skin.id)}" />
                    <strong>${localizedSkin(skin.id)}</strong>
                    <span>${unlocked ? "مفتوح" : `يفتح عند المستوى ${skin.unlockLevel}`}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>

        <div class="sheet-section">
          <div class="section-headline">
            <strong>الأسلحة</strong>
            <span>${blades.length} متاح</span>
          </div>
          <div class="media-grid media-grid-locker">
            ${blades
              .map(
                (blade) => `
                  <button class="media-card locker-card ${selectedBlade.id === blade.id ? "is-selected" : ""}" data-blade-select="${blade.id}">
                    <img src="${getBladeImage(blade.id)}" alt="${localizedBlade(blade.id)}" />
                    <strong>${localizedBlade(blade.id)}</strong>
                    <span>${blade.bonus}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function unlockOverlayGame() {
  const skin = skins.find((item) => item.id === state.overlay?.skinId);
  if (!skin) {
    return "";
  }

  return `
    <div class="overlay" data-close-unlock="true">
      <div class="sheet unlock-sheet" onclick="event.stopPropagation()">
        <div class="unlock-burst"></div>
        <img class="unlock-image" src="${getSkinImage(skin.id)}" alt="${localizedSkin(skin.id)}" />
        <div class="sheet-head centered">
          <div>
            <h2>تم فتح سكن جديد</h2>
            <p>السكن أضيف تلقائيًا وتم تجهيزه على حسابك الحالي.</p>
          </div>
        </div>
        <div class="unlock-meta">
          <strong>${localizedSkin(skin.id)}</strong>
          <span>تم فتحه عند المستوى ${state.profile.level}</span>
        </div>
        <button class="btn btn-primary" data-close-unlock="true">متابعة</button>
      </div>
    </div>
  `;
}

function renderToastGame() {
  return `
    <div class="toast-wrap ${state.toast ? "" : "hide"}">
      <div class="toast">${state.toast || ""}</div>
    </div>
  `;
}

function renderNavGame() {
  if (
    !state.profile ||
    state.screen === "onboarding" ||
    state.screen === "duel" ||
    state.screen === "home" ||
    !bootRuntime.ready
  ) {
    return "";
  }

  return `
    <nav class="footer-nav">
      <button class="nav-chip ${state.screen === "home" ? "is-active" : ""}" data-nav="home">الرئيسية</button>
      <button class="nav-chip ${state.screen === "duel" ? "is-active" : ""}" data-nav="duel">القتال</button>
      <button class="nav-chip ${state.screen === "rooms" ? "is-active" : ""}" data-nav="rooms">الغرف</button>
      <button class="nav-chip" data-open-overlay="locker">الخزنة</button>
    </nav>
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
  let screenMarkup = "";

  if (!bootRuntime.ready) {
    screenMarkup = renderSplash();
  } else if (state.screen === "home") {
    screenMarkup = renderHome();
  } else if (state.screen === "rooms") {
    screenMarkup = renderRoomsGame();
  } else if (state.screen === "duel") {
    screenMarkup = renderDuelGame();
  } else {
    screenMarkup = renderOnboarding();
  }

  app.innerHTML = `
    <main class="app-shell ${state.screen === "duel" ? "screen-duel" : ""}">
      ${screenMarkup}
      ${renderNavGame()}
    </main>
    ${
      bootRuntime.ready
        ? state.overlay?.type === "locker"
          ? lockerOverlayGame()
          : state.overlay?.type === "unlock"
            ? unlockOverlayGame()
            : ""
        : ""
    }
    ${renderToastGame()}
  `;

  syncAudioForScreen();

  if (attachEvents && bootRuntime.ready) {
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

  document.querySelectorAll("[data-blade-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.profile.bladeId = button.dataset.bladeSelect;
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
          showToast("تم إنشاء غرفة جديدة.");
        }
      }
      if (action === "copy") {
        copyRoomLink();
      }
      if (action === "join") {
        if (await joinRoom()) {
          showToast(`تم دخول الغرفة ${state.roomCodeActive}.`);
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

async function initRealtimeBackground() {
  try {
    const api = await loadFirebaseApi();
    roomRuntime.infoUnsubscribe = api.subscribeRealtimeInfo((info) => {
      roomRuntime.connected = info.connected;
      roomRuntime.serverOffset = info.serverOffset;
      render();
    });

    if (state.profile && state.roomCodeActive) {
      await attachRoomSubscription(state.roomCodeActive);
      void joinRoom();
    }
  } catch {
    roomRuntime.connected = false;
    render();
  }
}

restoreHashRoom();
render();
saveSettings();
void bootAssets();
void initRealtimeBackground();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

window.DuelDashDev = {
  resetProgress,
  state,
};
