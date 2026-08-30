import type { HTMLAttributes } from "react";

export function Alert({
  className = "",
  variant = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly variant?: "default" | "destructive" | "success";
}) {
  return (
    <div
      className={`alert alert-${variant} ${className}`.trim()}
      role="alert"
      {...props}
    />
  );
}
