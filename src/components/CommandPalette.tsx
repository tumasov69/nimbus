import {
  Box,
  Compass,
  Home,
  LayoutGrid,
  Search,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import type { Route } from "../routes";
import { errorText, useStore } from "../store";
import { instanceIconSrc } from "./ui";

interface Command {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  /** Extra text matched by the search query (not displayed). */
  keywords?: string;
  run: () => void;
}

/**
 * Spotlight-style command palette (Ctrl/⌘+K). Lets the user jump to any page,
 * open any instance, or switch account by keyboard. Mounted only while open, so
 * the search input autofocuses on mount and state resets every time.
 */
export function CommandPalette({
  onClose,
  navigate,
}: {
  onClose: () => void;
  navigate: (r: Route) => void;
}) {
  const { t } = useTranslation();
  const { instances, accounts, refreshAccounts, toast } = useStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (r: Route) => () => {
      onClose();
      navigate(r);
    };
    const pages: Command[] = [
      { id: "p-home", label: t("nav.home"), group: t("palette.pages"), icon: <Home className="size-4" />, run: go({ page: "home" }) },
      { id: "p-instances", label: t("nav.instances"), group: t("palette.pages"), icon: <LayoutGrid className="size-4" />, run: go({ page: "instances" }) },
      { id: "p-browse", label: t("nav.browse"), group: t("palette.pages"), icon: <Compass className="size-4" />, run: go({ page: "browse" }) },
      { id: "p-accounts", label: t("nav.accounts"), group: t("palette.pages"), icon: <Users className="size-4" />, run: go({ page: "accounts" }) },
      { id: "p-settings", label: t("nav.settings"), group: t("palette.pages"), icon: <SettingsIcon className="size-4" />, run: go({ page: "settings" }) },
    ];
    const inst: Command[] = instances.map((i) => {
      const src = instanceIconSrc(i);
      return {
        id: `i-${i.id}`,
        label: i.name,
        group: t("instances.title"),
        keywords: `${i.mcVersion} ${i.loader}`,
        icon: src ? (
          <img src={src} alt="" className="size-4 rounded object-cover" />
        ) : (
          <Box className="size-4" />
        ),
        run: () => {
          onClose();
          navigate({ page: "instance", id: i.id });
        },
      };
    });
    const accs: Command[] = accounts.accounts.map((a) => ({
      id: `a-${a.id}`,
      label: a.username,
      group: t("accounts.title"),
      keywords: a.id === accounts.active ? t("accounts.active") : "",
      icon: (
        <img
          src={`https://mc-heads.net/avatar/${a.kind === "microsoft" ? a.uuid : a.username}/32`}
          alt=""
          className="size-4 rounded"
        />
      ),
      run: async () => {
        onClose();
        if (a.id === accounts.active) return;
        try {
          await api.setActiveAccount(a.id);
          await refreshAccounts();
          toast("success", t("accounts.loggedAs", { name: a.username }));
        } catch (e) {
          toast("error", errorText(e));
        }
      },
    }));
    return [...pages, ...inst, ...accs];
  }, [t, instances, accounts, navigate, onClose, refreshAccounts, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Keep the selection in range as the filtered list shrinks.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selected]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className="card popover w-full max-w-xl overflow-hidden !rounded-2xl"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-stroke px-4">
          <Search className="size-4 shrink-0 text-t3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={t("palette.placeholder")}
            className="w-full bg-transparent py-3.5 text-sm text-t1 outline-none placeholder-t3"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-t3">
              {t("browse.nothingFound")}
            </div>
          ) : (
            filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {header && (
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-t3">
                      {header}
                    </div>
                  )}
                  <button
                    data-idx={i}
                    onMouseMove={() => setSelected(i)}
                    onClick={c.run}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                      i === selected ? "bg-accent-soft text-t1" : "text-t2"
                    }`}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-t3">
                      {c.icon}
                    </span>
                    <span className="truncate">{c.label}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
