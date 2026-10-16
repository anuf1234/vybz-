import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-violet text-white hover:bg-violet/85",
  ghost: "border border-line text-text hover:border-violet",
  subtle: "bg-surface-2 text-text hover:bg-surface-3",
  danger: "border border-red-400/50 text-red-200 hover:bg-red-400/10",
};
const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", block = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet ${VARIANTS[variant]} ${SIZES[size]} ${block ? "w-full" : ""}`;
}

export function Btn({
  variant,
  size,
  block,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; block?: boolean }) {
  return <button {...props} className={`${buttonClass(variant, size, block)} ${className}`} />;
}

export function LinkButton({
  variant,
  size,
  block,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; block?: boolean }) {
  return <Link {...props} className={`${buttonClass(variant, size, block)} ${className}`} />;
}
