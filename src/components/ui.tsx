import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import i18n from "../i18n";
import { useStore } from "../store";
import type { Instance, LoaderKind } from "../types";

/** Resolves the best icon src for an instance: custom file → remote url.
 *  Custom icons get a unique filename per change, so no cache-busting needed. */
export function instanceIconSrc(instance: Instance): string | null {
  if (instance.iconPath) {
    return convertFileSrc(instance.iconPath);
  }
  return instance.iconUrl ?? null;
}

/** Lightweight loading placeholder. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-bg-soft ${className}`}
      style={{ animationDuration: "1.4s" }}
    />
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} />;
}

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  // Portal: pages animate with a transform, which would otherwise trap
  // position:fixed inside the page container.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card popover w-full ${width} max-h-[85vh] flex flex-col animate-modal-in`}
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button className="btn-ghost !p-2" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ProgressBar({
  value,
  className = "",
}: {
  value: number; // 0..1
  className?: string;
}) {
  return (
    <div className={`h-1.5 w-full rounded-full bg-bg-soft overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

const LOADER_COLORS: Record<LoaderKind, string> = {
  vanilla: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  fabric: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  quilt: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
  forge: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  neoforge: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
};

export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

export function LoaderBadge({ loader }: { loader: LoaderKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${LOADER_COLORS[loader]}`}
    >
      {LOADER_LABELS[loader]}
    </span>
  );
}

export function SelectWrap({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-t3" />
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-t2">{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="h-6 w-11 rounded-full bg-bg-soft border border-stroke transition-colors peer-checked:bg-accent peer-checked:border-transparent after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export function Dropdown({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className="card popover absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden !rounded-xl p-1 animate-modal-in"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                item.danger
                  ? "text-danger hover:bg-danger-soft"
                  : "text-t2 hover:bg-accent-soft hover:text-t1"
              }`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return createPortal(
    <div className="fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="card popover animate-fade-up flex items-start gap-3 p-3.5 text-sm"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <span
            className={`mt-1 size-2 shrink-0 rounded-full ${
              t.kind === "error"
                ? "bg-danger"
                : t.kind === "success"
                  ? "bg-success"
                  : "bg-accent"
            }`}
          />
          <span className="flex-1 break-words text-t2">{t.text}</span>
          <button
            className="text-t3 hover:text-t1 cursor-pointer"
            onClick={() => dismissToast(t.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function formatRelativeDate(iso?: string | null): string {
  if (!iso) return i18n.t("common.never");
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return i18n.t("common.justNow");
  if (minutes < 60) return i18n.t("common.minAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return i18n.t("common.daysAgo", { n: days });
  return date.toLocaleDateString(i18n.language);
}
