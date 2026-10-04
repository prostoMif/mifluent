import type { Metadata } from "next";
import { getOperator, legalLanguage } from "@/lib/legal";

export const metadata: Metadata = { title: "Оферта / Terms" };

const EDITION = "4 октября 2026 г.";

export default async function TermsPage() {
  const operator = getOperator();
  const language = await legalLanguage();

  if (language === "en") {
    return (
      <main className="legal-page">
        <h1>Terms of Service</h1>
        <p className="legal-meta">
          Edition of 4 October 2026. The binding text is the Russian public offer on this page for
          Russian-speaking readers; this is a summary of it.
        </p>
        <section>
          <h2>Who provides the service</h2>
          <p>
            {operator.name}, self-employed (tax ID {operator.inn}), Russia. Contact:{" "}
            {operator.telegram}, {operator.email}.
          </p>
        </section>
        <section>
          <h2>What it is</h2>
          <p>
            Mifluent finds your competitors and the platforms you depend on, watches their public
            pages, feeds and news, and sends you a digest of what changed, with a quote and a link.
            It is provided as is: some sites may be unavailable or change their layout, and the
            model&apos;s interpretation can be wrong. Decisions are yours.
          </p>
        </section>
        <section>
          <h2>Plans and payment</h2>
          <p>
            The free plan (3 targets, weekly digest) has no time limit. Paid plans are prepaid in
            full for 1, 3, 6 or 12 months through ЮKassa and never renew by themselves; when the
            term ends the account returns to the free plan and keeps its data.
          </p>
        </section>
        <section>
          <h2>Refunds</h2>
          <p>
            Within 14 days of paying you get the full amount back, no reasons needed — write to the
            contacts above. Refunds go back the same way within 10 business days.
          </p>
        </section>
        <section>
          <h2>Law</h2>
          <p>These terms are governed by the laws of the Russian Federation.</p>
        </section>
        <p>
          See also the <a href="/privacy">Privacy Policy</a> and <a href="/contacts">Contacts</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="legal-page">
      <h1>Публичная оферта на использование сервиса Mifluent</h1>
      <p className="legal-meta">Редакция от {EDITION}</p>

      <section>
        <h2>1. Кто мы и что это за документ</h2>
        <p>
          1.1. Исполнитель — {operator.name}, плательщик налога на профессиональный доход
          (самозанятый), ИНН {operator.inn} (далее — Исполнитель).
        </p>
        <p>
          1.2. Этот документ — публичная оферта (ст. 437 ГК РФ). Оплатив любой платный тариф или
          начав пользоваться бесплатным тарифом, вы (далее — Пользователь) принимаете её условия
          полностью (ст. 438 ГК РФ).
        </p>
      </section>

      <section>
        <h2>2. Что мы делаем</h2>
        <p>
          2.1. Mifluent — онлайн-сервис на сайте {operator.site}. По адресу сайта или описанию
          бизнеса Пользователя он подбирает конкурентов и другие источники, следит за изменениями на
          их общедоступных страницах, в лентах и новостях (цены, тарифы, акции, условия) и сообщает
          Пользователю об изменениях в Telegram-боте или по электронной почте.
        </p>
        <p>
          2.2. Сервис предоставляется «как есть». Исполнитель старается, чтобы каждое сообщение
          содержало ссылку на источник и дословную цитату, но не гарантирует полноту и
          своевременность: часть сайтов может быть недоступна или изменить устройство. Решения,
          принятые по сообщениям сервиса, Пользователь принимает сам.
        </p>
        <p>
          2.3. Сервис использует автоматическую обработку текста, в том числе языковые модели.
          Выводы модели помечаются в сообщениях отдельно от цитат.
        </p>
      </section>

      <section>
        <h2>3. Тарифы и оплата</h2>
        <p>
          3.1. Бесплатный тариф — до 3 целей наблюдения и сводка раз в неделю, без ограничения
          срока.
        </p>
        <p>
          3.2. Платные тарифы, их стоимость и лимиты указаны на странице{" "}
          <a href="/pricing">«Тарифы»</a> на момент оплаты. Цена, действовавшая в момент оплаты, не
          меняется до конца оплаченного срока.
        </p>
        <p>
          3.3. Оплата — 100% предоплата за выбранный срок (1, 3, 6 или 12 месяцев) через платёжный
          сервис ЮKassa или иным способом, согласованным с Исполнителем. Подписка сама не
          продлевается: по окончании срока аккаунт переходит на бесплатный тариф, данные не
          удаляются.
        </p>
        <p>
          3.4. Чек формируется в «Мой налог» и направляется Пользователю после оплаты: при оплате
          через ЮKassa — автоматически. НДС не облагается (Исполнитель применяет НПД).
        </p>
        <p>
          3.5. Услуга считается оказанной надлежащим образом, если в течение оплаченного срока
          сервис был доступен Пользователю.
        </p>
      </section>

      <section>
        <h2>4. Возврат денег</h2>
        <p>
          4.1. В течение 14 дней с даты оплаты Пользователь может отказаться от платного тарифа без
          объяснения причин и получить полную сумму — кнопкой в настройках или написав Исполнителю в
          Telegram {operator.telegram} или на {operator.email}.
        </p>
        <p>
          4.2. После 14 дней возврат возможен за неиспользованные полные месяцы оплаченного срока,
          если сервис не работал по вине Исполнителя больше 3 дней подряд.
        </p>
        <p>
          4.3. Деньги возвращаются тем же способом, которым были оплачены, в течение 10 рабочих
          дней. Чек об оплате аннулируется.
        </p>
      </section>

      <section>
        <h2>5. Права и обязанности</h2>
        <p>
          5.1. Пользователь обязуется не использовать сервис для нарушения закона и не пытаться
          нарушить его работу.
        </p>
        <p>
          5.2. Исполнитель может приостановить доступ при нарушении п. 5.1, вернув деньги за
          неиспользованный срок.
        </p>
        <p>
          5.3. Исполнитель может менять сервис и условия оферты, уведомив Пользователя не менее чем
          за 7 дней. Изменения не ухудшают условия уже оплаченного срока.
        </p>
      </section>

      <section>
        <h2>6. Ответственность</h2>
        <p>
          6.1. Ответственность Исполнителя ограничена суммой, уплаченной Пользователем за последний
          оплаченный срок.
        </p>
        <p>
          6.2. Исполнитель не отвечает за содержание сторонних сайтов и за перерывы, вызванные
          сбоями хостинга, Telegram, платёжных сервисов и сетей связи.
        </p>
      </section>

      <section>
        <h2>7. Персональные данные</h2>
        <p>
          Обработка персональных данных — по{" "}
          <a href="/privacy">Политике обработки персональных данных</a>. Начиная пользоваться
          сервисом, Пользователь даёт согласие на обработку своих данных на условиях Политики.
        </p>
      </section>

      <section>
        <h2>8. Споры</h2>
        <p>
          Споры решаются переговорами, претензия рассматривается в течение 10 рабочих дней. Если
          договориться не удалось — в суде по законодательству Российской Федерации.
        </p>
      </section>

      <section>
        <h2>9. Реквизиты и контакты</h2>
        <p>
          {operator.name}, плательщик НПД, ИНН {operator.inn}
          <br />
          Telegram: {operator.telegram}
          <br />
          Почта: {operator.email}
        </p>
      </section>
    </main>
  );
}
