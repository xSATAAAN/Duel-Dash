const STORAGE_KEY = "duel-dash-state-v2";

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
};

let orientationLockAttempted = false;

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

function setScreen(screen) {
  appState.screen = screen;
  elements.lobby.style.display = screen === "lobby" ? "flex" : "none";
  elements.arena.style.display = screen === "arena" ? "block" : "none";

  if (screen === "arena") {
    resizeCanvas();
  }
}

function resizeCanvas() {
  const canvas = elements.canvas;
  const context = canvas.getContext("2d");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawArenaPlaceholder(context, width, height);
}

function drawArenaPlaceholder(context, width, height) {
  context.clearRect(0, 0, width, height);

  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, "#020617");
  backdrop.addColorStop(0.55, "#0f172a");
  backdrop.addColorStop(1, "#111827");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const leftGlow = context.createRadialGradient(width * 0.22, height * 0.18, 0, width * 0.22, height * 0.18, width * 0.24);
  leftGlow.addColorStop(0, "rgba(34, 211, 238, 0.34)");
  leftGlow.addColorStop(1, "rgba(34, 211, 238, 0)");
  context.fillStyle = leftGlow;
  context.fillRect(0, 0, width, height);

  const rightGlow = context.createRadialGradient(width * 0.8, height * 0.16, 0, width * 0.8, height * 0.16, width * 0.26);
  rightGlow.addColorStop(0, "rgba(129, 140, 248, 0.32)");
  rightGlow.addColorStop(1, "rgba(129, 140, 248, 0)");
  context.fillStyle = rightGlow;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(255,255,255,0.06)";
  for (let index = 0; index < width; index += 42) {
    context.fillRect(index, height * 0.62, 2, height * 0.16);
  }

  const floor = context.createLinearGradient(0, height * 0.7, 0, height);
  floor.addColorStop(0, "rgba(56, 189, 248, 0.06)");
  floor.addColorStop(0.18, "rgba(15, 23, 42, 0.3)");
  floor.addColorStop(1, "rgba(2, 6, 23, 0.95)");
  context.fillStyle = floor;
  context.fillRect(0, height * 0.62, width, height * 0.38);

  context.strokeStyle = "rgba(34, 211, 238, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(width / 2, height * 0.68, width * 0.18, height * 0.06, 0, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "rgba(248, 250, 252, 0.92)";
  context.font = "700 34px Changa";
  context.textAlign = "center";
  context.fillText("Arena Canvas Ready", width / 2, height * 0.2);

  context.fillStyle = "rgba(203, 213, 225, 0.88)";
  context.font = "500 18px Changa";
  context.fillText("المرحلة القادمة: حركة حرة + Joysticks + Combat Loop", width / 2, height * 0.26);
}

async function lockLandscape() {
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
  } catch {}
}

function bindEvents() {
  elements.findMatch.addEventListener("click", () => {
    setScreen("arena");
  });

  elements.backToLobby.addEventListener("click", () => {
    setScreen("lobby");
  });

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
  setScreen("lobby");
  bindEvents();
  resizeCanvas();
  void lockLandscape();
  registerServiceWorker();
  window.__duelDashBooted = true;
}

init();
