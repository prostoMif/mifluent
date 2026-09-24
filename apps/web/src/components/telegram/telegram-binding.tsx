"use client";

/**
 * Binding a profile's digests to a Telegram chat.
 *
 * The code is shown once and never stored in the browser: it lives ten
 * minutes on the server, is spent by the first chat that sends it, and anyone
 * holding it until then could point the digests at their own chat.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import formStyles from "@/components/ui/form.module.css";
import { Notice } from "@/components/ui/notice";
import { sendRequest } from "@/lib/api-client";
import { toDisplayMessage } from "@/lib/error-message";

export interface TelegramBindingProps {
  readonly profileId: string;
  readonly isBound: boolean;
  readonly isConfigured: boolean;
  /** The bot's @name, when the instance knows it. */
  readonly botUsername: string | undefined;
}

interface BindingCode {
  readonly code: string;
  readonly expiresAt: string;
}

export function TelegramBinding({
  profileId,
  isBound,
  isConfigured,
  botUsername,
}: TelegramBindingProps) {
  const router = useRouter();
  const [code, setCode] = useState<BindingCode | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  if (!isConfigured) {
    return (
      <Notice tone="neutral">
        Telegram delivery is not set up on this instance. The owner sets TELEGRAM_BOT_TOKEN to turn
        it on.
      </Notice>
    );
  }

  async function request(method: "POST" | "DELETE"): Promise<void> {
    setIsPending(true);
    setError(undefined);
    try {
      const path = `/api/watch-profiles/${profileId}/telegram-binding`;
      if (method === "POST") {
        setCode(await sendRequest<BindingCode>({ method, path }));
      } else {
        await sendRequest({ method, path });
        router.refresh();
      }
    } catch (thrown) {
      setError(toDisplayMessage(thrown));
    } finally {
      setIsPending(false);
    }
  }

  const bot = botUsername === undefined ? "the bot" : `@${botUsername}`;

  return (
    <div className={formStyles["form"]}>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}

      {isBound ? (
        <p>Digests for this profile go to your Telegram chat.</p>
      ) : code === undefined ? (
        <p>Get this profile's digests in Telegram, with buttons to mark what mattered.</p>
      ) : (
        <Notice tone="neutral">
          Send <code>/start {code.code}</code> to {bot} within ten minutes. Then reload this page.
        </Notice>
      )}

      <div className={formStyles["actions"]}>
        <button
          className={formStyles["button"]}
          disabled={isPending}
          onClick={() => {
            void request("POST");
          }}
          type="button"
        >
          {isBound ? "Move to another chat" : "Link Telegram"}
        </button>
        {isBound ? (
          <button
            className={`${formStyles["button"]} ${formStyles["secondary"]}`}
            disabled={isPending}
            onClick={() => {
              void request("DELETE");
            }}
            type="button"
          >
            Stop sending to Telegram
          </button>
        ) : null}
      </div>
    </div>
  );
}
