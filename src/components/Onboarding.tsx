import { Cloud, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { LANGUAGES } from "../i18n";
import { errorText, useStore } from "../store";
import type { McVersion, Settings } from "../types";
import { Field, SelectWrap, Spinner } from "./ui";

/**
 * First-run wizard: pick a language, enter a nickname and create a starter
 * instance so a brand-new user can be in-game in a few clicks.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { settings, setSettings, refreshInstances, refreshAccounts, toast } =
    useStore();
  const [nick, setNick] = useState("");
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [mcVersion, setMcVersion] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getMinecraftVersions()
      .then((v) => {
        const releases = v.filter((x) => x.type === "release");
        setVersions(releases);
        if (releases[0]) setMcVersion(releases[0].id);
      })
      .catch(() => {});
  }, []);

  const currentLang = settings?.language ?? "";

  const setLanguage = (language: string) => {
    if (!settings) return;
    const next: Settings = { ...settings, language };
    setSettings(next);
    api.saveSettings(next).catch(() => {});
  };

  const startedHint = useMemo(
    () => nick.trim().length >= 3 && mcVersion,
    [nick, mcVersion],
  );

  const finish = async (play: boolean) => {
    setBusy(true);
    try {
      if (play) {
        await api.addOfflineAccount(nick);
        await refreshAccounts();
        const inst = await api.createInstance(
          `Minecraft ${mcVersion}`,
          mcVersion,
          "vanilla",
          null,
          true,
        );
        await refreshInstances();
        await api.launchInstance(inst.id);
      }
      onDone();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-6">
      <div
        className="card popover w-full max-w-md animate-modal-in p-7"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg">
            <Cloud className="size-7" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("onboarding.welcome")}
          </h1>
          <p className="mt-1 text-sm text-t3">{t("onboarding.subtitle")}</p>
        </div>

        <div className="flex flex-col gap-4">
          <Field label={t("settings.language")}>
            <SelectWrap>
              <select
                className="select-base"
                value={currentLang}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="">{t("settings.languageAuto")}</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("home.nickname")}>
              <input
                className="input-base"
                placeholder="Steve"
                value={nick}
                onChange={(e) => setNick(e.target.value)}
              />
            </Field>
            <Field label={t("home.version")}>
              <SelectWrap>
                <select
                  className="select-base"
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
                </select>
              </SelectWrap>
            </Field>
          </div>

          <button
            className="btn-primary mt-1 w-full"
            disabled={!startedHint || busy}
            onClick={() => finish(true)}
          >
            {busy ? <Spinner /> : <Play className="size-4 fill-current" />}
            {t("onboarding.start")}
          </button>
          <button
            className="text-center text-xs text-t3 hover:text-t1 cursor-pointer"
            onClick={() => finish(false)}
          >
            {t("onboarding.skip")}
          </button>
        </div>
      </div>
    </div>
  );
}
