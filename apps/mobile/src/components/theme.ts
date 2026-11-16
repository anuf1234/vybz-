import { Platform } from "react-native";

/**
 * VYBZ tokens (same as the web app). Neon is reserved for live and winner
 * states so it keeps its meaning; everything else is flat surfaces.
 */
export const color = {
  ink: "#0B0614",
  surface1: "#140C22",
  surface2: "#1D1230",
  surface3: "#2A1A44",
  line: "#33224F",
  plum: "#2A0E4F",
  violet: "#8B5CF6",
  violetSoft: "#C4B5FD",
  text: "#F4F0FB",
  muted: "#A59CBB",
  live: "#39FF88",
  win: "#39FF88",
  lose: "#6B6280",
  danger: "#FF6B8A",
  sideA: "#8B5CF6",
  sideB: "#F5A524",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/** Condensed, athletic face for scoreboards and round numbers. */
export const displayFont = Platform.select({
  ios: "AvenirNextCondensed-Heavy",
  android: "sans-serif-condensed",
  default: '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif',
});

export const type = {
  display: { fontFamily: displayFont, fontWeight: "800" as const, letterSpacing: 0.5, color: color.text },
  title: { fontSize: 22, fontWeight: "700" as const, color: color.text },
  heading: { fontSize: 17, fontWeight: "700" as const, color: color.text },
  body: { fontSize: 15, color: color.text },
  small: { fontSize: 13, color: color.muted },
  label: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.2, textTransform: "uppercase" as const, color: color.muted },
};
