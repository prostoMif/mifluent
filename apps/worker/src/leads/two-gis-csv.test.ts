import { describe, expect, it } from "vitest";
import { competitorsFor, parseCsv, readTwoGisCsv, whatsappNumber } from "./two-gis-csv.js";

const EXPORT = [
  "﻿sep=,",
  "Наименование,Рубрики,Адрес,Город,Рейтинг,Количество отзывов,Телефон 1,E-mail 1,Веб-сайт 1,WhatsApp 1,Telegram",
  'Джордж Групп,Частные стоматологии,"улица Адмирала Фокина, 29",Владивосток,4.9,487,84232025239,GGFKN@g-george.ru,http://g-george.ru,,https://t.me/g_george_bot',
  'ПримаДент,"Стоматологии; ""Детские""",проспект 100-летия,Владивосток,4.5,20,+7 (914) 000-00-00,,primadent.ru,https://wa.me/79140000001,',
  "Без сайта,Стоматологии,улица,Владивосток,5,900,,,,,",
  "Джордж Групп филиал,Стоматологии,улица,Владивосток,4.9,10,,,https://www.g-george.ru,,",
].join("\r\n");

describe("2GIS export", () => {
  it("reads quoted fields with commas and doubled quotes", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("turns rows into leads, normalising sites and emails", () => {
    const leads = readTwoGisCsv(EXPORT);
    expect(leads).toHaveLength(4);
    expect(leads[0]).toMatchObject({
      name: "Джордж Групп",
      address: "улица Адмирала Фокина, 29",
      rating: 4.9,
      reviews: 487,
      email: "ggfkn@g-george.ru",
      website: "http://g-george.ru",
    });
    expect(leads[1]?.website).toBe("https://primadent.ru");
    expect(leads[1]?.rubrics).toBe('Стоматологии; "Детские"');
  });

  it("picks competitors with their own site, never the lead's own domain", () => {
    const leads = readTwoGisCsv(EXPORT);
    const george = leads[0];
    if (george === undefined) throw new Error("no lead");
    expect(competitorsFor(george, leads, 5).map((lead) => lead.name)).toEqual(["ПримаДент"]);
  });

  it("builds a wa.me number from a link or a phone", () => {
    const leads = readTwoGisCsv(EXPORT);
    expect(leads[1] === undefined ? null : whatsappNumber(leads[1])).toBe("79140000001");
    expect(leads[0] === undefined ? null : whatsappNumber(leads[0])).toBe("74232025239");
  });
});
