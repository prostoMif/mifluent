import type { Metadata } from "next";
import { getOperator, legalLanguage } from "@/lib/legal";

export const metadata: Metadata = { title: "Контакты / Contacts" };

export default async function ContactsPage() {
  const operator = getOperator();
  const isRussian = (await legalLanguage()) === "ru";

  return (
    <main className="legal-page">
      <h1>{isRussian ? "Контакты" : "Contacts"}</h1>
      <p>
        {isRussian
          ? "Mifluent — сервис наблюдения за ценами, акциями и правилами конкурентов и площадок."
          : "Mifluent watches your competitors' and platforms' prices, offers and rules."}
      </p>
      <p>
        {operator.name}, {isRussian ? "самозанятый (НПД), ИНН" : "self-employed, tax ID"}{" "}
        {operator.inn}
        <br />
        Telegram: {operator.telegram}
        <br />
        {isRussian ? "Почта" : "Email"}: {operator.email}
        <br />
        {isRussian ? "Сайт" : "Site"}: {operator.site}
      </p>
      <p>
        <a href="/terms">{isRussian ? "Оферта" : "Terms"}</a> ·{" "}
        <a href="/privacy">{isRussian ? "Политика обработки персональных данных" : "Privacy"}</a> ·{" "}
        <a href="/pricing">{isRussian ? "Тарифы" : "Pricing"}</a>
      </p>
    </main>
  );
}
