import type { HTMLAttributes } from "react";

export function Badge({
  className = "",
  variant = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  readonly variant?: "neutral" | "success" | "warning" | "critical";
}) {
  return (
    <span className={`badge badge-${variant} ${className}`.trim()} {...props} />
  );
}
