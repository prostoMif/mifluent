/**
 * Layout for Telegram Mini App pages.
 *
 * No header, no footer, no site navigation. The Mini App runs inside a
 * Telegram webview and uses Telegram's native UI components (BackButton,
 * MainButton, themeParams).
 *
 * The theme is applied via CSS variables derived from Telegram's themeParams.
 */

import type { ReactNode } from "react";
import "./tg-theme.css";

export default function TgLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="tg-shell">
      <main id="main" className="tg-content">
        {children}
      </main>
    </div>
  );
}
