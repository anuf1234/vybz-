import { Image } from "expo-image";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { color, radius, space, type } from "./theme";

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  kind = "primary",
  loading,
  disabled,
  style,
  ...rest
}: { title: string; kind?: ButtonKind; loading?: boolean; style?: ViewStyle } & Omit<PressableProps, "style" | "children">) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={({ pressed }) => [styles.button, styles[kind], off && styles.disabled, pressed && !off && styles.pressed, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={kind === "primary" ? color.ink : color.text} />
      ) : (
        <Text style={[styles.buttonText, kind === "primary" && { color: "#FFFFFF" }, kind === "danger" && { color: color.danger }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ text, tone = "default" }: { text: string; tone?: "default" | "live" | "violet" | "warn" }) {
  const toneStyle =
    tone === "live"
      ? { borderColor: color.live, color: color.live }
      : tone === "violet"
        ? { borderColor: color.violet, color: color.violetSoft }
        : tone === "warn"
          ? { borderColor: color.sideB, color: color.sideB }
          : { borderColor: color.line, color: color.muted };
  return (
    <View style={[styles.pill, { borderColor: toneStyle.borderColor }]}>
      {tone === "live" && <View style={styles.liveDot} />}
      <Text style={[styles.pillText, { color: toneStyle.color }]}>{text}</Text>
    </View>
  );
}

export function Avatar({ name, image, size = 36, ring }: { name: string; image?: string | null; size?: number; ring?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const border = ring ? { borderWidth: 2, borderColor: ring } : null;
  if (image) return <Image source={{ uri: image }} style={[{ width: size, height: size, borderRadius: size / 2 }, border]} />;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, border]}>
      <Text style={{ color: color.text, fontWeight: "700", fontSize: size * 0.38 }}>{initials || "?"}</Text>
    </View>
  );
}

/** Square cover art; `round` for artist photos. */
export function Artwork({ uri, size = 56, round = false }: { uri: string | null | undefined; size?: number; round?: boolean }) {
  const shape = [styles.art, { width: size, height: size }, round && { borderRadius: size / 2 }];
  if (!uri) return <View style={shape} />;
  return <Image source={{ uri }} style={shape} contentFit="cover" transition={150} />;
}

export function Field({ label, error, ...rest }: { label: string; error?: string | null } & TextInputProps) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        placeholderTextColor={color.lose}
        style={[styles.input, error ? { borderColor: color.danger } : null]}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? <Text style={[type.small, { color: color.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && { color: color.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={type.heading}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBanner} accessibilityRole="alert">
      <Text style={{ color: color.text, flex: 1 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={{ color: color.violetSoft, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={color.violet} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={type.label}>{children}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: color.violet },
  secondary: { backgroundColor: color.surface3, borderWidth: 1, borderColor: color.line },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  buttonText: { color: color.text, fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: color.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: space.lg, gap: space.md },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.live },
  avatar: { backgroundColor: color.plum, alignItems: "center", justifyContent: "center" },
  art: { borderRadius: radius.sm, backgroundColor: color.surface3 },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.text, paddingHorizontal: space.md, fontSize: 16 },
  segmented: { flexDirection: "row", backgroundColor: color.surface1, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: color.line },
  segment: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.sm },
  segmentActive: { backgroundColor: color.surface3 },
  segmentText: { color: color.muted, fontWeight: "700", fontSize: 14 },
  empty: { alignItems: "center", justifyContent: "center", padding: space.xxl, gap: space.md },
  errorBanner: { flexDirection: "row", gap: space.md, alignItems: "center", backgroundColor: "#3A1424", borderRadius: radius.md, padding: space.md },
  sectionTitle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.lg, marginBottom: space.sm },
});
