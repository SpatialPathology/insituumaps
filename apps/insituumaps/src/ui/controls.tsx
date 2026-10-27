/**
 * Small styled controls on native HTML elements (robust, accessible, no
 * extra dependencies)
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-b border-zinc-200 px-3 py-3", className)}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1 block text-xs font-medium text-zinc-600", className)}
    >
      {children}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:border-sky-500 focus:ring-2 focus:ring-sky-200 focus:outline-none disabled:opacity-50",
        className,
      )}
    >
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-md border border-zinc-300 bg-white p-0.5 shadow-xs"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === option.value
              ? "bg-sky-600 text-white shadow-sm"
              : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-sky-600" : "bg-zinc-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
      {label}
    </label>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("h-1.5 w-full cursor-pointer", className)}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "sm",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5" : "h-9 px-3",
        variant === "primary" &&
          "border-sky-700 bg-sky-600 text-white hover:bg-sky-700",
        variant === "default" &&
          "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100",
        variant === "ghost" &&
          "border-transparent bg-transparent text-zinc-700 hover:bg-zinc-200",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  id,
  className,
  type = "text",
  ariaLabel,
  onKeyDown,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  type?: "text" | "number" | "url";
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200 focus:outline-none",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent",
        className,
      )}
    />
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-zinc-500">{children}</p>;
}
