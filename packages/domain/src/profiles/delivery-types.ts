/** The delivery settings' shape, importable by the browser (no database code). */
export interface DeliverySettings {
  readonly cadence: "daily" | "weekly";
  readonly weekday: number;
  readonly hour: number;
  readonly timezone: string;
  readonly channel: "telegram" | "email";
  readonly language: "en" | "ru";
}
