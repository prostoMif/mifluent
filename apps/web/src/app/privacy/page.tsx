import type { Metadata } from "next";
import { getOperator, legalLanguage } from "@/lib/legal";

export const metadata: Metadata = { title: "Политика ПДн / Privacy" };

const EDITION = "4 октября 2026 г.";

export default async function PrivacyPage() {
  const operator = getOperator();
  const language = await legalLanguage();

  if (language === "en") {
    return (
      <main className="legal-page">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">
          Edition of 4 October 2026. A summary of the Russian policy on this page, which is the
          binding text (Federal Law 152-FZ).
        </p>
        <section>
          <h2>Who processes your data</h2>
          <p>
            {operator.name}, self-employed (tax ID {operator.inn}), Russia. Contact:{" "}
            {operator.telegram}, {operator.email}.
          </p>
        </section>
        <section>
          <h2>What, where and why</h2>
          <p>
            Your email and/or Telegram id, the business description and targets you confirm, payment
            records (plan, term, amount, date — never card details, which only ЮKassa sees) and
            technical records of your actions. Stored on a server in the Russian Federation, used
            only to run the service, take payment and answer you. Never sold, never used for
            advertising, never used to train models.
          </p>
        </section>
        <section>
          <h2>Who else sees it</h2>
          <p>
            ЮKassa (payments), Telegram (delivery to the bot), the email provider (delivery by
            email), the tax service via «Мой налог» (receipt: amount, date, service). Language
            models receive public website texts and your business description — not your email,
            Telegram id or name.
          </p>
        </section>
        <section>
          <h2>Deleting your data</h2>
          <p>
            Write to the contacts above. Your account, business, targets, digests and logs are
            deleted within 30 days; receipts stay in «Мой налог», as tax law requires.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="legal-page">
      <h1>Политика обработки персональных данных Mifluent</h1>
      <p className="legal-meta">
        Редакция от {EDITION}. Составлена по Федеральному закону от 27.07.2006 № 152-ФЗ «О
        персональных данных».
      </p>

      <section>
        <h2>1. Оператор</h2>
        <p>
          {operator.name}, ИНН {operator.inn}, плательщик НПД (далее — Оператор). Связь: Telegram{" "}
          {operator.telegram}, {operator.email}.
        </p>
      </section>

      <section>
        <h2>2. Какие данные мы обрабатываем</h2>
        <ul>
          <li>
            идентификатор, имя и имя пользователя (username) в Telegram — если вы пользуетесь ботом;
          </li>
          <li>адрес электронной почты — если вы его указали;</li>
          <li>адрес сайта, описание бизнеса и выбранные цели наблюдения;</li>
          <li>
            сведения об оплатах: тариф, срок, сумма, дата, статус. Данные банковской карты Оператор
            не получает и не хранит — их обрабатывает ЮKassa;
          </li>
          <li>
            технические данные: дата и время действий в сервисе, нажатия кнопок в сообщениях, хэш
            IP-адреса (для ограничения злоупотреблений).
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Зачем</h2>
        <ul>
          <li>оказание услуги по оферте: настройка наблюдения и отправка сообщений;</li>
          <li>приём оплаты, выдача чеков, возвраты;</li>
          <li>ответы на обращения и уведомления о работе сервиса;</li>
          <li>улучшение отбора сообщений по вашим реакциям.</li>
        </ul>
      </section>

      <section>
        <h2>4. Основания</h2>
        <p>
          Исполнение договора (п. 5 ч. 1 ст. 6 152-ФЗ) и ваше согласие (п. 1 ч. 1 ст. 6 152-ФЗ).
        </p>
      </section>

      <section>
        <h2>5. Где и как долго хранятся</h2>
        <p>
          5.1. Данные хранятся на сервере, расположенном на территории Российской Федерации.
          Резервные копии зашифрованы.
        </p>
        <p>
          5.2. Тексты источников (сырьё) хранятся от 30 дней до года в зависимости от тарифа.
          Сводки, события и ваши отметки — пока у вас есть аккаунт.
        </p>
        <p>
          5.3. После удаления аккаунта данные удаляются в течение 30 дней. Чеки остаются в «Мой
          налог», как того требует налоговое законодательство.
        </p>
      </section>

      <section>
        <h2>6. Кому передаются</h2>
        <ul>
          <li>ООО НКО «ЮМани» (ЮKassa) — для приёма оплаты;</li>
          <li>Telegram — для доставки сообщений в бот;</li>
          <li>почтовый сервис Оператора — для доставки писем;</li>
          <li>
            ФНС России через «Мой налог» — сведения о расчёте (сумма, дата, наименование услуги) для
            чека.
          </li>
        </ul>
        <p>
          Для анализа общедоступных страниц сервис использует языковые модели. Модели получают
          тексты общедоступных сайтов и описание бизнеса; вашу почту, Telegram-идентификатор и имя
          мы в модели не передаём. Данные не продаются, не передаются для рекламы и не используются
          для обучения моделей.
        </p>
      </section>

      <section>
        <h2>7. Защита</h2>
        <p>
          Доступ к серверу и базе данных есть только у Оператора; соединения шифруются (HTTPS);
          секретные ключи хранятся отдельно от кода; резервные копии шифруются.
        </p>
      </section>

      <section>
        <h2>8. Cookies</h2>
        <p>
          Только необходимые: cookie сессии входа, временная cookie онбординга (24 часа) и cookie
          приглашения (1 час). Аналитики, рекламы и сторонних cookie нет.
        </p>
      </section>

      <section>
        <h2>9. Ваши права</h2>
        <p>
          Вы можете узнать, какие данные о вас хранятся, потребовать исправить или удалить их,
          отозвать согласие — написав Оператору в Telegram {operator.telegram} или на{" "}
          {operator.email}. Ответ — в течение 10 рабочих дней. Отзыв согласия означает удаление
          аккаунта. Вы вправе обжаловать действия Оператора в Роскомнадзоре или в суде.
        </p>
      </section>
    </main>
  );
}
