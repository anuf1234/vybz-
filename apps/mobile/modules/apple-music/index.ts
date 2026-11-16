import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/** Native MusicKit bridge (iOS only). Null on Android, web and in Expo Go. */
export interface AppleMusicNative {
  authorize(): Promise<"authorized" | "denied" | "restricted" | "notDetermined" | "unknown">;
  authorizationStatus(): Promise<string>;
  canPlayCatalog(): Promise<boolean>;
  play(catalogId: string): Promise<void>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  status(): Promise<{ playing: boolean; position: number }>;
}

export const AppleMusicNativeModule: AppleMusicNative | null =
  Platform.OS === "ios" ? requireOptionalNativeModule<AppleMusicNative>("AppleMusic") : null;
