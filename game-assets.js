function svgUri(markup) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`;
}

function panelPattern(primary, secondary, label, glyph) {
  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 768">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stop-color="rgba(255,255,255,.28)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect width="768" height="768" rx="56" fill="#0b0f18" />
      <rect x="28" y="28" width="712" height="712" rx="48" fill="url(#bg)" />
      <rect x="52" y="52" width="664" height="664" rx="40" fill="rgba(12,15,23,.18)" stroke="rgba(255,255,255,.16)" />
      <circle cx="565" cy="178" r="150" fill="url(#glow)" />
      <path d="M96 622L244 442L332 520L444 338L670 108" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="20" stroke-linecap="round" />
      <text x="84" y="160" font-size="88" fill="rgba(255,255,255,.22)" font-family="Arial" font-weight="700">${glyph}</text>
      <text x="84" y="646" font-size="72" fill="#fff6ec" font-family="Arial" font-weight="800">${label}</text>
    </svg>
  `);
}

function arenaPattern(label, primary, secondary) {
  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="#060a12" />
      <rect width="1600" height="900" fill="url(#bg)" opacity="0.72" />
      <circle cx="280" cy="180" r="240" fill="rgba(255,123,79,.16)" />
      <circle cx="1330" cy="210" r="220" fill="rgba(63,210,182,.16)" />
      <circle cx="890" cy="710" r="240" fill="rgba(108,136,255,.10)" />
      <rect x="130" y="120" width="1340" height="660" rx="52" fill="rgba(5,10,18,.48)" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
      <path d="M250 680H1350" stroke="rgba(255,255,255,.12)" stroke-width="14" stroke-linecap="round" />
      <path d="M440 680V420H1160V680" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="10" />
      <path d="M800 240L980 420L800 600L620 420Z" fill="rgba(255,255,255,.08)" />
      <text x="800" y="110" font-size="84" fill="rgba(255,244,235,.82)" font-family="Arial" font-weight="800" text-anchor="middle">${label}</text>
    </svg>
  `);
}

function iconBadge(primary, secondary, glyph) {
  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="#0b0f18" />
      <rect x="18" y="18" width="220" height="220" rx="42" fill="url(#g)" />
      <text x="128" y="148" font-size="86" fill="#fff7ef" font-family="Arial" font-weight="800" text-anchor="middle">${glyph}</text>
    </svg>
  `);
}

function logoArt() {
  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 320">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ff6c3d" />
          <stop offset="100%" stop-color="#47d0b3" />
        </linearGradient>
      </defs>
      <rect width="880" height="320" rx="56" fill="#090d15" />
      <rect x="24" y="24" width="832" height="272" rx="44" fill="url(#g)" opacity="0.9" />
      <rect x="46" y="46" width="788" height="228" rx="34" fill="rgba(10,12,20,.44)" stroke="rgba(255,255,255,.14)" />
      <text x="100" y="150" font-size="76" fill="#fff2e8" font-family="Arial" font-weight="900">DUEL</text>
      <text x="100" y="232" font-size="76" fill="#f6fff9" font-family="Arial" font-weight="900">DASH</text>
      <circle cx="700" cy="120" r="56" fill="rgba(255,255,255,.18)" />
      <path d="M632 214L698 92L750 148L706 232Z" fill="#fff5eb" opacity=".92" />
    </svg>
  `);
}

export const ASSET_URLS = {
  branding: {
    logo: logoArt(),
  },
  backgrounds: {
    splash: arenaPattern("DUEL DASH", "#2b0f0f", "#08121b"),
    lobby: arenaPattern("LOBBY", "#291112", "#091927"),
    arena: arenaPattern("ARENA", "#2b1017", "#0a1922"),
    room: arenaPattern("ROOM", "#20102c", "#0d1721"),
  },
  fighters: {
    nova: panelPattern("#ff7b4a", "#ffb56d", "NOVA", "N"),
    flux: panelPattern("#40d2b6", "#84f0c5", "FLUX", "F"),
    warden: panelPattern("#7fc8ff", "#daeefe", "WARDEN", "W"),
    ember: panelPattern("#ff8560", "#ff4e65", "EMBER", "E"),
    arc: panelPattern("#ffbf58", "#ff8751", "ARC", "A"),
    drift: panelPattern("#4dd0ff", "#4ce4c7", "DRIFT", "D"),
    rival: panelPattern("#a95cff", "#39d4b2", "RIVAL", "R"),
  },
  blades: {
    ignite: panelPattern("#ff7d4e", "#ffbe74", "IGNITE", "I"),
    riptide: panelPattern("#3dd6cb", "#7ef1d2", "RIPTIDE", "R"),
    comet: panelPattern("#ffc766", "#ff8a4d", "COMET", "C"),
    halo: panelPattern("#7fc3ff", "#f3f7ff", "HALO", "H"),
  },
  skins: {
    "crimson-rush": panelPattern("#ff7356", "#ff485f", "CRIMSON", "C"),
    "jade-circuit": panelPattern("#3fd7bb", "#8ef0bf", "JADE", "J"),
    "solar-drive": panelPattern("#ffc56a", "#ff8b42", "SOLAR", "S"),
    "glacier-loop": panelPattern("#95dbff", "#f1fbff", "GLACIER", "G"),
    "night-shift": panelPattern("#756eff", "#0f1324", "NIGHT", "N"),
  },
  abilities: {
    attack: iconBadge("#ff7047", "#ffb46b", "A"),
    dash: iconBadge("#35d4c4", "#8ef3cc", "D"),
    special: iconBadge("#ffd26e", "#ff8b4d", "S"),
  },
  audio: {
    lobbyBgm: "",
    hit: "",
    dash: "",
    special: "",
    win: "",
    loss: "",
  },
};

export function collectPreloadUrls() {
  const buckets = Object.values(ASSET_URLS).flatMap((group) => Object.values(group));
  return buckets.filter((value) => typeof value === "string" && value.length > 0 && !value.endsWith(".mp3"));
}

export function getFighterImage(id) {
  return ASSET_URLS.fighters[id] || ASSET_URLS.fighters.rival;
}

export function getBladeImage(id) {
  return ASSET_URLS.blades[id] || ASSET_URLS.blades.ignite;
}

export function getSkinImage(id) {
  return ASSET_URLS.skins[id] || ASSET_URLS.skins["crimson-rush"];
}

export function getAbilityImage(id) {
  return ASSET_URLS.abilities[id] || ASSET_URLS.abilities.attack;
}
