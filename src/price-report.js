import { EmbedBuilder } from "discord.js";

export const ROLE_SUBSCRIPTION_EMOJI = "🔔";
export const PRICE_REPORT_FOOTER =
  "Учитывается цена до скобок · Диапазоны задаются командой /range";

function formatPrice(price) {
  return `$${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(price)}`;
}

export function findOffersInRanges(offersByItem, ranges = {}) {
  return [...offersByItem.entries()]
    .filter(([key]) => ranges[key])
    .map(([key, offers]) => {
      const range = ranges[key];
      const eligibleOffers = offers.filter(
        ({ price }) => price >= range.minimum && price <= range.maximum,
      );
      if (eligibleOffers.length === 0) {
        return null;
      }

      return {
        item: offers[0].item,
        key,
        offers: eligibleOffers.sort(
          (left, right) =>
            right.price - left.price ||
            left.buyer.localeCompare(right.buyer, "ru-RU"),
        ),
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) =>
      left.item.localeCompare(right.item, "ru-RU", { sensitivity: "base" }),
    );
}

export function createPriceEmbeds(priceGroups, publishedAt = new Date()) {
  const fields = priceGroups.map(({ item, offers }) => {
    return {
      name: item,
      value: offers
        .map(({ buyer, price, referencePrice }) => {
          const displayedPrice =
            referencePrice === undefined
              ? formatPrice(price)
              : `${formatPrice(price)} (${formatPrice(referencePrice)})`;
          return `**${displayedPrice}** · ${buyer}`;
        })
        .join("\n"),
      inline: true,
    };
  });

  const embeds = [];
  for (let index = 0; index < fields.length; index += 25) {
    const page = Math.floor(index / 25) + 1;
    embeds.push(
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(page === 1 ? "🔔 Предложения скупщиков" : "Предложения · продолжение")
        .setDescription(
          page === 1
            ? "Все предложения в настроенных диапазонах цен."
            : "Остальные товары из опубликованного списка.",
        )
        .addFields(fields.slice(index, index + 25))
        .setFooter({ text: PRICE_REPORT_FOOTER })
        .setTimestamp(publishedAt),
    );
  }

  return embeds;
}
