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
| Home | Today's battle, featured battles, battles waiting for your vote, live battles, open challenges, recent results; notification bell |
| Battles | Mine / Open / To vote |
| Create | Duel or group battle (3–8 players), up to 3 genres, era, rounds, length preset, judging, open or direct challenge or invites, public or private |
| Battle stage | Scoreboard and round tracker, sealed picks, blind A/B entries at the same playback tier, listen meter, vote, round results, final result with stats and rematch; group lobby; track hearts; chat, reactions and viewer count; report; moderator feature/void |
| Pick | Catalog search; each hit shows how a guest would hear it |
| Notifications | Challenges, invites, picks due, results; tap to open the battle |
| Moderation | Staff only: open reports, hide message, void battle, suspend user, dismiss |
| Rankings, Profile | Leaderboard by wins; record, recent battles, edit handle and name |

Playback follows each provider's rules: Apple previews and VYBZ-hosted audio play through `expo-audio`, YouTube plays in its own visible player. Listening is counted as time actually playing (not the playhead), reported to the server, and the server caps it at wall-clock time before unlocking the vote.

## Push notifications

Push needs an EAS project: run `npx eas-cli@latest init` once (it writes `extra.eas.projectId` to the app config), then use a development build on a real phone. Without a project id, or on simulators and the web, the app skips push and the in-app notification list still works. On the server, `PUSH_NOTIFICATIONS=false` turns sending off; `EXPO_ACCESS_TOKEN` is needed only if you turn on push security in your Expo account.

## Apple Music full tracks (iOS)

Subscribers connect Apple Music in Profile → Music services. The app then plays full songs through MusicKit (`modules/apple-music`, a local Expo module in Swift) and tells the server it can, with the `X-VYBZ-Apple-Music: full` header, so battles offer "Apple Music · Full" next to YouTube.

Setup before building:
1. In the Apple Developer portal, enable the **MusicKit** App Service for the `com.urexp.vybz` App ID (Identifiers → your App ID → App Services). No API key is needed in the app; MusicKit signs requests automatically.
2. Build a development or production build (`npx expo run:ios` or EAS). Expo Go doesn't include the module; there the option simply doesn't appear.

Android and the web build play Apple Music 30-second previews (there's no Expo-compatible Apple Music SDK for Android yet) and YouTube full songs.

## Checks

```bash
pnpm --filter @vybz/mobile typecheck
pnpm --filter @vybz/mobile test
npx expo export --platform ios --platform android --platform web   # bundles all three
```

Release builds: `npx eas-cli@latest build --profile production` (API URL per profile in `eas.json`).
