/**
 * The niche dictionary: which words in a profile's description put it in a
 * niche, so that packs restricted to that niche apply.
 *
 * Kept in code rather than beside the pack files: selection reads it on every
 * run, and a constant needs no file on the worker's disk and no sync step.
 * Aliases are matched as whole words against the lower-cased description,
 * the profile's "what matters" and its customer type.
 */

import type { NicheDictionary } from "./schema.js";

export const NICHES: NicheDictionary = {
  ecommerce: {
    aliases: {
      ru: ["интернет-магазин", "интернет магазин", "магазин", "e-commerce", "ecommerce"],
      en: ["online store", "e-commerce", "ecommerce", "dtc brand"],
    },
  },
  marketplace_seller: {
    aliases: {
      ru: ["селлер", "продавец", "маркетплейс", "маркетплейсы", "wildberries", "ozon", "вб"],
      en: ["seller", "marketplace", "amazon seller", "etsy shop", "fba"],
    },
  },
  saas: {
    aliases: {
      ru: ["saas", "сервис по подписке", "облачный сервис", "b2b сервис"],
      en: ["saas", "software as a service", "subscription software", "b2b software"],
    },
  },
  mobile_app: {
    aliases: {
      ru: ["мобильное приложение", "приложение для ios", "приложение для android"],
      en: ["mobile app", "ios app", "android app"],
    },
  },
  edtech: {
    aliases: {
      ru: ["онлайн-школа", "онлайн школа", "курсы", "обучение", "инфобизнес"],
      en: ["online course", "courses", "edtech", "online school", "education"],
    },
  },
  agency: {
    aliases: {
      ru: ["агентство", "студия", "digital-агентство"],
      en: ["agency", "studio", "consultancy"],
    },
  },
  services_local: {
    aliases: {
      ru: ["салон", "кафе", "ресторан", "клиника"],
      en: ["salon", "cafe", "restaurant", "clinic", "local business"],
    },
  },
  food_delivery: {
    aliases: {
      ru: ["доставка еды", "доставка продуктов"],
      en: ["food delivery", "grocery delivery"],
    },
  },
  fintech: {
    aliases: {
      ru: ["финтех", "платежи", "эквайринг"],
      en: ["fintech", "payments", "payment processing"],
    },
  },
  media_creator: {
    aliases: {
      ru: ["блогер", "telegram-канал", "медиа", "автор контента"],
      en: ["creator", "newsletter", "media", "content creator"],
    },
  },
  b2b_services: {
    aliases: {
      ru: ["b2b", "для бизнеса", "аутсорсинг"],
      en: ["b2b", "for businesses", "outsourcing"],
    },
  },
};
