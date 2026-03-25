# Duel Dash

`Duel Dash` is an iPhone-first PWA shell for a two-player competitive brawler. This repository is set up to feel like a native app while staying compatible with free static hosting.

## What is already included

- Native-feel onboarding with a saved local profile
- XP, levels, coins, restore code, and skin unlocks
- Locker flow and loadout UI
- Firebase-backed room code and invite-link flow
- Practice duel with fast combat actions
- Live 1v1 room sync through Firebase Realtime Database
- PWA manifest and service worker for Add to Home Screen

## Hosting choice

`GitHub Pages` is a good fit for:

- The frontend shell
- The PWA install flow
- Static assets and offline caching

`GitHub Pages` is **not enough by itself** for:

- Live room sync
- Realtime HP and action updates
- Match presence between two phones

## Best free architecture

- Host frontend on `GitHub Pages`
- Use `Firebase Realtime Database` for rooms, actions, and live duel sync
- Tighten Firebase rules after the first successful end-to-end test

## Next step to make true two-phone multiplayer live

1. Create a free backend project in Firebase or Supabase
2. Add client config values into the app
3. Replace the current demo room flow with realtime room state
4. Sync player actions, HP, timer, and winner state

## iPhone polish checklist

- Use Safari `Add to Home Screen`
- Keep the manifest icons as PNG
- Run in `standalone` display mode
- Keep interactions short and button-first
- Avoid browser-looking navigation

## About GitHub account access

If you connect a GitHub repo to your Codex workflow later, this project is ready to drop in. In the current workspace, everything is prepared locally first.
