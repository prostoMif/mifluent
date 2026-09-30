/**
 * Onboarding translations.
 *
 * All strings in one place, keyed by language. Components import the hook
 * and call t("key") — no scattered literals.
 */

export type Language = "en" | "ru";

export interface Translations {
  // Start page
  readonly startTitle: string;
  readonly startSubtitle: string;
  readonly startInputLabel: string;
  readonly startInputHint: string;
  readonly startHint: string;
  readonly startButton: string;
  readonly startButtonPending: string;
  readonly startClaimHint: string;

  // Waitlist
  readonly waitlistTitle: string;
  readonly waitlistSubtitle: string;
  readonly waitlistEmailLabel: string;
  readonly waitlistEmailPlaceholder: string;
  readonly waitlistButton: string;

  // Channel selection
  readonly whereToSend: string;
  readonly chooseChannel: string;
  readonly channelLabel: string;
  readonly emailChannel: string;
  readonly emailChannelDesc: string;
  readonly telegramChannel: string;
  readonly telegramChannelDesc: string;
  readonly emailLabel: string;
  readonly enterEmail: string;
  readonly consentPrefix: string;
  readonly consentAnd: string;
  readonly consentSuffix: string;
  readonly sendMagicLink: string;
  readonly continueToTelegram: string;
  readonly sending: string;
  readonly continuing: string;
  readonly selectChannel: string;

  // Check email page
  readonly checkEmailTitle: string;
  readonly checkEmailSubtitle: string;
  readonly checkEmailResend: string;
  readonly checkEmailResending: string;
  readonly checkEmailBack: string;

  // Telegram link page
  readonly telegramLinkTitle: string;
  readonly telegramLinkSubtitle: string;
  readonly telegramLinkButton: string;
  readonly telegramLinkBack: string;

  // Discovery review (anonymous)
  readonly reviewTitle: string;
  readonly reviewSubtitle: string;
  readonly reviewBusiness: string;
  readonly reviewName: string;
  readonly reviewMonetization: string;
  readonly reviewPlatforms: string;
  readonly reviewCountries: string;
  readonly reviewHomeCountry: string;
  readonly reviewCustomerType: string;
  readonly reviewWhatMatters: string;
  readonly reviewDescription: string;
  readonly reviewTargets: string;
  readonly reviewTargetsHint: string;
  readonly reviewAddCompetitor: string;
  readonly reviewAddCompetitorName: string;
  readonly reviewAddCompetitorSite: string;
  readonly reviewAddCompetitorButton: string;
  readonly reviewContinue: string;
  readonly reviewSaving: string;
  readonly reviewFactQuestions: string;
  readonly reviewFactQuestion1: string;
  readonly reviewFactQuestion2: string;
  readonly reviewFactQuestion3: string;

  // Progress page
  readonly progressTitle: string;
  readonly progressSubtitle: string;

  // Common
  readonly privacy: string;
  readonly terms: string;
  readonly languageSwitcher: string;
  readonly languageEn: string;
  readonly languageRu: string;
}

const translations: Record<Language, Translations> = {
  en: {
    // Start page
    startTitle: "Monitoring that works out what to monitor.",
    startSubtitle:
      "Tell Mifluent what your business does. It works out which competitors, which platforms you depend on and which rules apply to you — then every morning tells you what changed and what that means for you.",
    startInputLabel: "Your site's address, or what you do in one sentence",
    startInputHint:
      'For example https://example.com — or "We sell handmade tea in Telegram to buyers in Russia".',
    startHint: "This takes about two minutes. No account needed yet.",
    startButton: "Continue",
    startButtonPending: "Starting…",
    startClaimHint:
      "This instance has no owner yet. The first person to complete onboarding becomes the owner.",

    // Waitlist
    waitlistTitle: "Currently by invitation only",
    waitlistSubtitle:
      "This instance is not open for public registration yet. Leave your email and we'll let you know when it opens.",
    waitlistEmailLabel: "Email",
    waitlistEmailPlaceholder: "you@example.com",
    waitlistButton: "Join waitlist",

    // Channel selection
    whereToSend: "Where to send your digest?",
    chooseChannel: "Choose how you want to receive your morning briefing:",
    channelLabel: "Delivery channel",
    emailChannel: "Email",
    emailChannelDesc: "A magic link signs you in. No password, ever.",
    telegramChannel: "Telegram",
    telegramChannelDesc: "Get the digest in a chat. Email still needed for account identity.",
    emailLabel: "Email address",
    enterEmail: "Enter your email address",
    consentPrefix: "By continuing you agree to the ",
    consentAnd: " and ",
    consentSuffix: ".",
    sendMagicLink: "Send magic link",
    continueToTelegram: "Continue to Telegram",
    sending: "Sending…",
    continuing: "Continuing…",
    selectChannel: "Please select a delivery channel",

    // Check email page
    checkEmailTitle: "Check your email",
    checkEmailSubtitle: "We've sent a magic link to {email}. It expires in 30 minutes.",
    checkEmailResend: "Resend link",
    checkEmailResending: "Sending…",
    checkEmailBack: "Back to start",

    // Telegram link page
    telegramLinkTitle: "Open in Telegram",
    telegramLinkSubtitle:
      "Click the button below to open the bot and bind your account. Your first digest will arrive there.",
    telegramLinkButton: "Open in Telegram",
    telegramLinkBack: "Back to start",

    // Discovery review (anonymous)
    reviewTitle: "Here is what I understood",
    reviewSubtitle: "Review and adjust. The defaults are sensible — you can change anything later.",
    reviewBusiness: "The business",
    reviewName: "Name",
    reviewMonetization: "How it earns",
    reviewPlatforms: "Platforms it runs on",
    reviewCountries: "Where do you sell?",
    reviewHomeCountry: "Where do you live / where is the business registered?",
    reviewCustomerType: "Customers",
    reviewWhatMatters: "What matters most",
    reviewDescription: "What it does",
    reviewTargets: "What to watch",
    reviewTargetsHint:
      "{selected} selected. Your plan allows {remaining} more. ✓ means the address answered when checked; ✗ means it did not, and will be tried anyway if you keep it.",
    reviewAddCompetitor: "Who else do you consider a competitor?",
    reviewAddCompetitorName: "Name",
    reviewAddCompetitorSite: "Website",
    reviewAddCompetitorButton: "Add competitor",
    reviewContinue: "Continue",
    reviewSaving: "Saving…",
    reviewFactQuestions: "A few things I couldn't find — help me get them right:",
    reviewFactQuestion1:
      "What is your main pricing model? (free / trial / subscription / one-time / unknown)",
    reviewFactQuestion2: "Which platforms does your business run on? (comma-separated)",
    reviewFactQuestion3:
      "Who are your customers? (e.g., 'SMBs in Germany', 'developers worldwide')",

    // Progress page
    progressTitle: "Reading your site…",
    progressSubtitle: "This takes a minute or two. We'll update this page when it's ready.",

    // Common
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    languageSwitcher: "Language",
    languageEn: "English",
    languageRu: "Русский",
  },
  ru: {
    // Start page
    startTitle: "Мониторинг, который сам понимает, за чем следить.",
    startSubtitle:
      "Расскажите Mifluent, чем занимается ваш бизнес. Он определит, за какими конкурентами, платформами и правилами следить — и каждое утро будет присылать, что изменилось и что это для вас значит.",
    startInputLabel: "Адрес вашего сайта или описание бизнеса в одном предложении",
    startInputHint:
      'Например https://example.com — или "Мы продаём ручной чай в Telegram покупателям в России".',
    startHint: "Это займёт около двух минут. Аккаунт пока не нужен.",
    startButton: "Продолжить",
    startButtonPending: "Запускаю…",
    startClaimHint:
      "У этого экземпляра пока нет владельца. Первый, кто пройдёт онбординг, станет владельцем.",

    // Waitlist
    waitlistTitle: "Пока только по приглашениям",
    waitlistSubtitle:
      "Этот экземпляр ещё не открыт для публичной регистрации. Оставьте email — сообщим, когда откроется.",
    waitlistEmailLabel: "Email",
    waitlistEmailPlaceholder: "you@example.com",
    waitlistButton: "В лист ожидания",

    // Channel selection
    whereToSend: "Куда присылать сводку?",
    chooseChannel: "Выберите, как хотите получать утреннюю рассылку:",
    channelLabel: "Канал доставки",
    emailChannel: "Почта",
    emailChannelDesc: "Магическая ссылка войдёт за вас. Пароля никогда не будет.",
    telegramChannel: "Telegram",
    telegramChannelDesc: "Сводка придёт в чат. Email всё равно нужен для идентификации аккаунта.",
    emailLabel: "Email",
    enterEmail: "Введите email",
    consentPrefix: "Продолжая, вы соглашаетесь с ",
    consentAnd: " и ",
    consentSuffix: ".",
    sendMagicLink: "Отправить магическую ссылку",
    continueToTelegram: "Продолжить в Telegram",
    sending: "Отправляю…",
    continuing: "Продолжаю…",
    selectChannel: "Выберите канал доставки",

    // Check email page
    checkEmailTitle: "Проверьте почту",
    checkEmailSubtitle: "Мы отправили магическую ссылку на {email}. Она действует 30 минут.",
    checkEmailResend: "Отправить снова",
    checkEmailResending: "Отправляю…",
    checkEmailBack: "Назад к вводу сайта",

    // Telegram link page
    telegramLinkTitle: "Открыть в Telegram",
    telegramLinkSubtitle:
      "Нажмите кнопку ниже, чтобы открыть бота и привязать аккаунт. Первая сводка придёт туда.",
    telegramLinkButton: "Открыть в Telegram",
    telegramLinkBack: "Назад к вводу сайта",

    // Discovery review (anonymous)
    reviewTitle: "Вот что я понял",
    reviewSubtitle:
      "Проверьте и скорректируйте. Значения по умолчанию обычно верны — всё можно поменять позже.",
    reviewBusiness: "Бизнес",
    reviewName: "Название",
    reviewMonetization: "Как зарабатывает",
    reviewPlatforms: "Платформы",
    reviewCountries: "Где продаёте?",
    reviewHomeCountry: "Где живёте / где зарегистрирован бизнес?",
    reviewCustomerType: "Клиенты",
    reviewWhatMatters: "Что важнее всего",
    reviewDescription: "Что делает бизнес",
    reviewTargets: "За чем следить",
    reviewTargetsHint:
      "{selected} выбрано. План позволяет ещё {remaining}. ✓ — адрес ответил при проверке; ✗ — не ответил, но будет пробоваться, если оставить.",
    reviewAddCompetitor: "Кого ещё считаете конкурентом?",
    reviewAddCompetitorName: "Название",
    reviewAddCompetitorSite: "Сайт",
    reviewAddCompetitorButton: "Добавить конкурента",
    reviewContinue: "Продолжить",
    reviewSaving: "Сохраняю…",
    reviewFactQuestions: "Несколько вещей я не нашёл — помогите уточнить:",
    reviewFactQuestion1:
      "Какая основная модель монетизации? (free / trial / subscription / one_time / unknown)",
    reviewFactQuestion2: "На каких платформах работает бизнес? (через запятую)",
    reviewFactQuestion3:
      "Кто ваши клиенты? (например, 'МСБ в Германии', 'разработчики по всему миру')",

    // Progress page
    progressTitle: "Читаю сайт…",
    progressSubtitle: "Это займёт минуту-две. Страница обновится, когда будет готово.",

    // Common
    privacy: "Политика приватности",
    terms: "Условия использования",
    languageSwitcher: "Язык",
    languageEn: "English",
    languageRu: "Русский",
  },
};

export function getTranslations(language: Language): Translations {
  return translations[language];
}

export function useTranslations(language: Language): (key: keyof Translations) => string {
  const t = getTranslations(language);
  return (key: keyof Translations) => t[key];
}
