# VYBZ mobile

Expo (SDK 58) app for iOS and Android, using Expo Router. It talks to the web app's `/api/v1` and signs in with the same Better Auth sessions.

## Run it

1. Start the web app (it's the API) from the repo root: `pnpm dev`. For a quick start without music-provider keys, set `VYBZ_DEMO_CATALOG=true` in `apps/web/.env.local`.
2. Point the app at it:

   ```bash
   cp .env.example .env.local
   # On a phone, use your computer's LAN address, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
   ```

3. `pnpm --filter @vybz/mobile start`, then open it in a development build (`npx expo run:ios` / `npx expo run:android`, or `eas build --profile development`). The app uses `expo-audio`, `expo-secure-store` and `react-native-webview`, which Expo Go may not bundle for SDK 58 yet.

## What's in it

| Screen | |
|---|---|
| Home | Battles waiting for your vote, live battles, open challenges, recent results |
| Battles | Mine / Open / To vote |
| Create | Theme presets (with era rules), rounds, open or direct challenge, pace, blind voting, live tallies |
| Battle stage | Scoreboard and round tracker, sealed picks, blind A/B entries at the same playback tier, listen meter, vote, round results, final result and rematch |
| Pick | Catalog search; each hit shows how a guest would hear it |
| Rankings, Profile | Leaderboard by wins; record, recent battles, edit handle and name |

Playback follows each provider's rules: Apple previews and VYBZ-hosted audio play through `expo-audio`, YouTube plays in its own visible player. Listening is counted as time actually playing (not the playhead), reported to the server, and the server caps it at wall-clock time before unlocking the vote.

## Checks

```bash
pnpm --filter @vybz/mobile typecheck
pnpm --filter @vybz/mobile test
npx expo export --platform ios --platform android --platform web   # bundles all three
```

Release builds: `npx eas-cli@latest build --profile production` (API URL per profile in `eas.json`).
