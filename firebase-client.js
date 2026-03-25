import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  onDisconnect,
  onValue,
  push,
  remove,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAgshwskbWtBTwUmnr8KsmndBIXdlFBxKQ",
  authDomain: "duel-dash-e0d0f.firebaseapp.com",
  databaseURL: "https://duel-dash-e0d0f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "duel-dash-e0d0f",
  storageBucket: "duel-dash-e0d0f.firebasestorage.app",
  messagingSenderId: "827483087573",
  appId: "1:827483087573:web:3abff7796f51dc5f37385c",
  measurementId: "G-X1J0W88P56",
};

const CLIENT_ID_KEY = "duel-dash-client-id-v1";

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

let connected = false;
let serverOffset = 0;
const infoSubscribers = new Set();

onValue(ref(database, ".info/connected"), (snapshot) => {
  connected = Boolean(snapshot.val());
  emitInfo();
});

onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
  serverOffset = Number(snapshot.val() || 0);
  emitInfo();
});

function emitInfo() {
  const payload = getRealtimeInfo();
  infoSubscribers.forEach((callback) => callback(payload));
}

function getOrCreateClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const next = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

function roomRef(code) {
  return ref(database, `rooms/${code}`);
}

function playerRef(code, clientId) {
  return ref(database, `rooms/${code}/players/${clientId}`);
}

function playerPayload(profile, clientId) {
  return {
    id: clientId,
    name: profile.name,
    avatarId: profile.avatarId,
    bladeId: profile.bladeId,
    skinId: profile.skinId,
    level: profile.level,
    joinedAt: serverTimestamp(),
    restoreCode: profile.restoreCode,
  };
}

const QUICK_ROOM_CODES = ["ARENA1", "ARENA2", "ARENA3", "ARENA4"];

function normalizeRoomCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

const clientId = getOrCreateClientId();

export function getClientId() {
  return clientId;
}

export function getRealtimeInfo() {
  return {
    connected,
    serverOffset,
    serverNow: Date.now() + serverOffset,
  };
}

export function subscribeRealtimeInfo(callback) {
  infoSubscribers.add(callback);
  callback(getRealtimeInfo());
  return () => {
    infoSubscribers.delete(callback);
  };
}

export async function createRoom(profile, requestedCode) {
  const code = normalizeRoomCode(requestedCode);
  const snapshot = await get(roomRef(code));
  if (snapshot.exists()) {
    throw new Error("Room code already exists.");
  }

  await set(roomRef(code), {
    code,
    status: "lobby",
    hostId: clientId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    duel: null,
    players: {
      [clientId]: playerPayload(profile, clientId),
    },
  });

  onDisconnect(playerRef(code, clientId)).remove();
  return code;
}

export async function joinRoom(profile, requestedCode) {
  const code = normalizeRoomCode(requestedCode);
  const snapshot = await get(roomRef(code));
  if (!snapshot.exists()) {
    throw new Error("Room not found.");
  }

  const room = snapshot.val();
  const players = room.players || {};
  const playerIds = Object.keys(players);
  const alreadyJoined = Boolean(players[clientId]);

  if (!alreadyJoined && playerIds.length >= 2) {
    throw new Error("Room is full.");
  }

  if (room.duel?.status === "live" && !alreadyJoined) {
    throw new Error("Match already started.");
  }

  const nextHostId =
    room.hostId && players[room.hostId]
      ? room.hostId
      : playerIds.length > 0
        ? playerIds[0]
        : clientId;

  await update(roomRef(code), {
    [`players/${clientId}`]: playerPayload(profile, clientId),
    hostId: nextHostId,
    updatedAt: serverTimestamp(),
  });

  onDisconnect(playerRef(code, clientId)).remove();
  return code;
}

export function subscribeRoom(code, callback) {
  return onValue(roomRef(normalizeRoomCode(code)), (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

export async function syncPlayerProfile(code, profile) {
  const normalized = normalizeRoomCode(code);
  await update(roomRef(normalized), {
    [`players/${clientId}/name`]: profile.name,
    [`players/${clientId}/avatarId`]: profile.avatarId || null,
    [`players/${clientId}/bladeId`]: profile.bladeId || null,
    [`players/${clientId}/skinId`]: profile.skinId || null,
    [`players/${clientId}/level`]: profile.level,
    [`players/${clientId}/restoreCode`]: profile.restoreCode || null,
    updatedAt: serverTimestamp(),
  });
  onDisconnect(playerRef(normalized, clientId)).remove();
}

export async function leaveRoom(code) {
  const normalized = normalizeRoomCode(code);
  const snapshot = await get(roomRef(normalized));
  if (!snapshot.exists()) {
    return;
  }

  const room = snapshot.val();
  const players = { ...(room.players || {}) };
  delete players[clientId];

  if (Object.keys(players).length === 0) {
    await remove(roomRef(normalized));
    return;
  }

  const nextHostId =
    room.hostId === clientId || !players[room.hostId] ? Object.keys(players)[0] : room.hostId;

  await update(roomRef(normalized), {
    [`players/${clientId}`]: null,
    hostId: nextHostId,
    updatedAt: serverTimestamp(),
  });
}

export async function setRoomHost(code, hostId) {
  await update(roomRef(normalizeRoomCode(code)), {
    hostId,
    updatedAt: serverTimestamp(),
  });
}

export async function startRoomDuel(code) {
  const normalized = normalizeRoomCode(code);
  const snapshot = await get(roomRef(normalized));
  if (!snapshot.exists()) {
    throw new Error("Room not found.");
  }

  const room = snapshot.val();
  const players = Object.keys(room.players || {});

  if (room.hostId !== clientId) {
    throw new Error("Only the host can start the match.");
  }

  if (players.length !== 2) {
    throw new Error("Two players are required.");
  }

  const duelId = `match-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await update(roomRef(normalized), {
    status: "live",
    updatedAt: serverTimestamp(),
    duel: {
      id: duelId,
      status: "live",
      startedAt: serverTimestamp(),
      durationMs: 90000,
      actions: null,
    },
  });

  return duelId;
}

export async function sendRoomAction(code, actionType) {
  const actionsRef = ref(database, `rooms/${normalizeRoomCode(code)}/duel/actions`);
  const nextRef = push(actionsRef);
  await set(nextRef, {
    actorId: clientId,
    type: actionType,
    createdAt: serverTimestamp(),
  });
}

export async function findOrCreateArenaRoom(profile) {
  const roomsSnapshot = await get(ref(database, "rooms"));
  const rooms = roomsSnapshot.val() || {};

  for (const code of QUICK_ROOM_CODES) {
    const room = rooms[code];
    if (!room || room.mode !== "canvas-arena") {
      continue;
    }

    const players = room.players || {};
    const joinedAlready = Boolean(players[clientId]);
    const playerCount = Object.keys(players).length;

    if (joinedAlready) {
      await syncPlayerProfile(code, profile);
      return code;
    }

    if (playerCount < 2) {
      await joinRoom(profile, code);
      await update(roomRef(code), {
        mode: "canvas-arena",
        status: "arena",
        updatedAt: serverTimestamp(),
      });
      return code;
    }
  }

  for (const code of QUICK_ROOM_CODES) {
    if (rooms[code]) {
      continue;
    }

    try {
      await createRoom(profile, code);
      await update(roomRef(code), {
        mode: "canvas-arena",
        status: "arena",
        updatedAt: serverTimestamp(),
      });
      return code;
    } catch {}
  }

  for (const code of QUICK_ROOM_CODES) {
    try {
      await joinRoom(profile, code);
      await update(roomRef(code), {
        mode: "canvas-arena",
        status: "arena",
        updatedAt: serverTimestamp(),
      });
      return code;
    } catch {}
  }

  throw new Error("جميع الساحات السريعة ممتلئة الآن.");
}

export async function syncPlayerPosition(code, position) {
  const normalized = normalizeRoomCode(code);
  await update(roomRef(normalized), {
    [`players/${clientId}/position`]: {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
      direction: Number(position.direction) === -1 ? -1 : 1,
      updatedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
  onDisconnect(playerRef(normalized, clientId)).remove();
}
