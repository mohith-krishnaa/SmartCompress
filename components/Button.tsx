import React from "react";
import { Slot } from "@radix-ui/react-slot";
import styles from "./Button.module.css";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "outline"
    | "ghost"
    | "link"
    | "secondary"
    | "destructive";
  size?: "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-md" | "icon-lg";
  /** "pill" makes the button fully rounded. */
  shape?: "default" | "pill";
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      shape = "default",
      asChild = false,
      className,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        type={type}
        className={`
        ${styles.button} 
        ${styles[variant]} 
        ${styles[size]} 
        ${shape === "pill" ? styles.pill : ""} 
        ${disabled ? styles.disabled : ""} 
        ${className || ""}
      `}
        disabled={disabled}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);

Button.displayName = "Button";
