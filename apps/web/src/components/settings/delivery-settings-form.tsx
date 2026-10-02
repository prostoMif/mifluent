"use client";

/**
 * When, where and in which language one profile's brief arrives. The plan
 * decides whether "every morning" is honoured; the form says so instead of
 * hiding the option.
 */

import type { DeliverySettings } from "@mifluent/domain/profiles/delivery-types";
import { useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { SelectField } from "@/components/ui/select-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";

const ZONES = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Vladivostok",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Almaty",
  "UTC",
];

const TEXT = {
  en: {
    cadence: "How often",
    daily: "Every morning",
    weekly: "Once a week",
    weekday: "Day",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    hour: "At",
    zone: "Time zone",
    channel: "Where",
    telegram: "Telegram",
    email: "Email",
    language: "Language of the brief",
    save: "Save",
    saving: "Saving…",
    saved: "Saved. The next brief follows these settings.",
    dailyNote: "Daily briefs are on Starter and above; on Free it arrives weekly.",
  },
  ru: {
    cadence: "Как часто",
    daily: "Каждое утро",
    weekly: "Раз в неделю",
    weekday: "День",
    days: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
    hour: "Во сколько",
    zone: "Часовой пояс",
    channel: "Куда",
    telegram: "Telegram",
    email: "Почта",
    language: "Язык сводки",
    save: "Сохранить",
    saving: "Сохраняю…",
    saved: "Сохранено. Следующая сводка придёт по этим настройкам.",
    dailyNote: "Ежедневная сводка — на тарифе Старт и выше; на Free приходит раз в неделю.",
  },
} as const;

export function DeliverySettingsForm({
  profileId,
  initial,
  isDailyAllowed,
}: {
  readonly profileId: string;
  readonly initial: DeliverySettings;
  readonly isDailyAllowed: boolean;
}) {
  const [settings, setSettings] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const text = TEXT[settings.language];
  const zones = ZONES.includes(settings.timezone) ? ZONES : [settings.timezone, ...ZONES];

  function set<K extends keyof DeliverySettings>(key: K, value: DeliverySettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setState("idle");
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState("saving");
    setError(null);
    try {
      await sendRequest({
        method: "PATCH",
        path: `/api/watch-profiles/${profileId}/delivery`,
        body: settings,
      });
      setState("saved");
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
      setState("idle");
    }
  }

  const id = (name: string) => `${profileId}-${name}`;
  return (
    <form className={formStyles["form"]} onSubmit={(event) => void save(event)}>
      {error === null ? null : <Notice tone="error">{error}</Notice>}
      {state === "saved" ? <Notice tone="success">{text.saved}</Notice> : null}
      <SelectField
        id={id("cadence")}
        name="cadence"
        label={text.cadence}
        value={settings.cadence}
        onChange={(value) => set("cadence", value === "daily" ? "daily" : "weekly")}
        options={[
          { value: "daily", label: text.daily },
          { value: "weekly", label: text.weekly },
        ]}
        {...(settings.cadence === "daily" && !isDailyAllowed ? { hint: text.dailyNote } : {})}
      />
      {settings.cadence === "weekly" ? (
        <SelectField
          id={id("weekday")}
          name="weekday"
          label={text.weekday}
          value={String(settings.weekday)}
          onChange={(value) => set("weekday", Number(value))}
          options={text.days.map((day, index) => ({ value: String(index + 1), label: day }))}
        />
      ) : null}
      <SelectField
        id={id("hour")}
        name="hour"
        label={text.hour}
        value={String(settings.hour)}
        onChange={(value) => set("hour", Number(value))}
        options={Array.from({ length: 24 }, (_, hour) => ({
          value: String(hour),
          label: `${String(hour).padStart(2, "0")}:00`,
        }))}
      />
      <SelectField
        id={id("zone")}
        name="timezone"
        label={text.zone}
        value={settings.timezone}
        onChange={(value) => set("timezone", value)}
        options={zones.map((zone) => ({ value: zone, label: zone.replace("_", " ") }))}
      />
      <SelectField
        id={id("channel")}
        name="channel"
        label={text.channel}
        value={settings.channel}
        onChange={(value) => set("channel", value === "email" ? "email" : "telegram")}
        options={[
          { value: "telegram", label: text.telegram },
          { value: "email", label: text.email },
        ]}
      />
      <SelectField
        id={id("language")}
        name="language"
        label={text.language}
        value={settings.language}
        onChange={(value) => set("language", value === "ru" ? "ru" : "en")}
        options={[
          { value: "ru", label: "Русский" },
          { value: "en", label: "English" },
        ]}
      />
      <div className={formStyles["actions"]}>
        <SubmitButton label={text.save} pendingLabel={text.saving} isPending={state === "saving"} />
      </div>
    </form>
  );
}
