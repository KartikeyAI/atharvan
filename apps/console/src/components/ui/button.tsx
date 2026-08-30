import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "default" | "outline" | "destructive" | "ghost";
}) {
  return (
    <button
      className={`button button-${variant} ${className}`.trim()}
      {...props}
    />
  );
}
