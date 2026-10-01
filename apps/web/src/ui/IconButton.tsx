import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Icon } from "./Icon";

/** Small glyphs keep a full, labelled hit target in every compact surface. */
export function IconButton({ icon, label, children, className = "", ...props }: {
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return <button type="button" title={label} {...props} aria-label={label}
    className={`ui-icon-button ${className}`}>
    <Icon name={icon} />{children}
  </button>;
}
