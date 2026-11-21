const SECTION_PATTERN =
  /(?:[:\w-]+:|<a?:[\w~]+:\d+>|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)?\s*_\*\*(?<buyer>Скупщик[^*]+)\*\*_\s*\r?\n```(?:[\w+-]+)?\s*\r?\n(?<body>[\s\S]*?)```/giu;
const PRICE_LINE_PATTERN =
  /^\s*-\s*(?<item>[^:]+):\s*\$(?<price>\d+(?:[.,]\d+)?)(?:\s*\(\s*\$(?<referencePrice>\d+(?:[.,]\d+)?)\s*\))?\s*$/u;

export function normalizeItemName(item) {
  return item.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

export function parsePriceMessage(content) {
  const offersByItem = new Map();
  let section;

  SECTION_PATTERN.lastIndex = 0;
  while ((section = SECTION_PATTERN.exec(content)) !== null) {
    const buyer = section.groups.buyer.trim();

    for (const line of section.groups.body.split(/\r?\n/u)) {
      const match = PRICE_LINE_PATTERN.exec(line);
      if (!match) {
        continue;
      }

      const item = match.groups.item.trim();
      const price = Number(match.groups.price.replace(",", "."));
      const referencePrice = match.groups.referencePrice
        ? Number(match.groups.referencePrice.replace(",", "."))
        : undefined;
      if (!item || !Number.isFinite(price)) {
        continue;
      }

      const key = normalizeItemName(item);
      const offers = offersByItem.get(key) ?? [];
      offers.push({ item, buyer, price, referencePrice });
      offersByItem.set(key, offers);
    }
  }

  return offersByItem;
}
