// How a shopping list turns into an estimate. Prices always come from the catalogue on the server —
// the browser never decides a price.
//
// Each catalogue item can have one or more "options" (how it's bought):
//   fixed  — Tomatoes · Basket · ₦20,000. Customer gives a quantity (2 baskets = ₦40,000)
//            OR just an amount ("₦7,000 of tomatoes"). An amount never implies a fraction of a basket.
//   range  — Rice · Bag · Basmati ₦80,000–₦95,000. Quantity gives a min–max estimate; or give an amount.
//   none   — no reliable price. Customer must give the amount to spend.
// Items with no options (or custom items not in the catalogue) are amount-only.
import { badRequest } from '../utils/errors.js';
import { money, toKobo, toNaira } from '../utils/money.js';

export const MIN_LINE_AMOUNT = 100;

export function optionLabel(option) {
  if (!option) return null;
  return option.variant ? `${option.unit_label} · ${option.variant}` : option.unit_label;
}

/** Public description of an option's price, e.g. "₦20,000" / "₦80,000 – ₦95,000" / "Market price varies". */
export function describeOptionPrice(o) {
  if (o.price_type === 'fixed') return { type: 'fixed', price: money(o.price) };
  if (o.price_type === 'range') return { type: 'range', min: money(o.price_min), max: money(o.price_max) };
  return { type: 'none' };
}

/**
 * Price one requested line against the catalogue.
 * @param line   { catalogItemId?, optionId?, customName?, requestMethod, quantity?, amount?, preferences?, allowSubstitution? }
 * @param item   catalogue item (with options) or null for a custom item
 * @param bookingType 'full_purchase' | 'sample_run'
 */
export function priceLine(line, item, bookingType, index = 0) {
  const where = `Item ${index + 1}`;
  const isSample = bookingType === 'sample_run';

  if (line.catalogItemId && !item) throw badRequest(`${where}: that item is no longer available.`);
  if (item && !item.active) throw badRequest(`${where}: ${item.name} is no longer available.`);

  const option = line.optionId ? item?.options.find((o) => o.id === line.optionId && o.active) : null;
  if (line.optionId && !option) throw badRequest(`${where}: please choose how you want to buy ${item?.name || 'this item'} again — the option has changed.`);
  if (item && item.options.some((o) => o.active) && !option && !isSample) {
    // Item has buying options but none was picked: allowed only as an open amount.
    if (!item.allow_open_amount) throw badRequest(`${where}: choose how you want to buy ${item.name}.`);
  }

  const name = item ? item.name : (line.customName || '').trim();
  if (!name) throw badRequest(`${where}: enter the item name.`);

  const base = {
    catalogItemId: item?.id ?? null,
    optionId: option?.id ?? null,
    itemName: name,
    optionLabel: optionLabel(option),
    priceType: option?.price_type || 'none',
    price: option?.price_type === 'fixed' ? money(option.price) : null,
    priceMin: option?.price_type === 'range' ? money(option.price_min) : null,
    priceMax: option?.price_type === 'range' ? money(option.price_max) : null,
    preferences: line.preferences?.trim() || null,
    allowSubstitution: Boolean(line.allowSubstitution) && (item ? Boolean(item.allow_substitutions) : true),
  };

  // Sample run: we're looking, not buying. Quantity/amount are optional context; no goods estimate.
  if (isSample) {
    return {
      ...base,
      requestMethod: line.requestMethod === 'quantity' && line.quantity ? 'quantity' : 'amount',
      quantity: line.requestMethod === 'quantity' && line.quantity ? line.quantity : null,
      amount: line.requestMethod === 'amount' && line.amount ? money(line.amount) : null,
      estimateMin: 0,
      estimateMax: 0,
    };
  }

  const quantityAllowed = option && option.price_type !== 'none' && option.allow_quantity;
  const amountAllowed = !item || !option || option.price_type === 'none' || item.allow_open_amount;

  if (line.requestMethod === 'quantity') {
    if (!quantityAllowed) throw badRequest(`${where}: ${name} is bought by amount — enter how much you want to spend.`);
    const qty = Number(line.quantity);
    if (!(qty > 0) || qty > 1000) throw badRequest(`${where}: enter a quantity for ${name}.`);
    const unitMin = option.price_type === 'fixed' ? toKobo(option.price) : toKobo(option.price_min);
    const unitMax = option.price_type === 'fixed' ? toKobo(option.price) : toKobo(option.price_max);
    return {
      ...base,
      requestMethod: 'quantity',
      quantity: Math.round(qty * 100) / 100,
      amount: null,
      estimateMin: toNaira(Math.round(unitMin * qty)),
      estimateMax: toNaira(Math.round(unitMax * qty)),
    };
  }

  if (!amountAllowed) throw badRequest(`${where}: ${name} must be bought by quantity.`);
  const amount = money(line.amount);
  if (!(amount >= MIN_LINE_AMOUNT)) throw badRequest(`${where}: enter how much you want to spend on ${name} (at least ₦${MIN_LINE_AMOUNT}).`);
  return { ...base, requestMethod: 'amount', quantity: null, amount, estimateMin: amount, estimateMax: amount };
}

export function priceLines(lines, itemsById, bookingType) {
  if (!lines.length) throw badRequest('Add at least one item to your list.');
  const priced = lines.map((l, i) => priceLine(l, l.catalogItemId ? itemsById.get(l.catalogItemId) : null, bookingType, i));
  const minK = priced.reduce((a, l) => a + toKobo(l.estimateMin), 0);
  const maxK = priced.reduce((a, l) => a + toKobo(l.estimateMax), 0);
  return { lines: priced, goodsMin: toNaira(minK), goodsMax: toNaira(maxK) };
}

/** Service fee from settings. Full shop: fixed + % of goods, clamped. Sample run: flat. */
export function serviceFee(bookingType, goodsAmount, pricing) {
  if (bookingType === 'sample_run') return money(pricing.sampleRunFee);
  const raw = toKobo(pricing.fullPurchaseFeeFixed) + Math.round(toKobo(goodsAmount) * (Number(pricing.fullPurchaseFeePercent) / 100));
  const clamped = Math.min(Math.max(raw, toKobo(pricing.fullPurchaseFeeMin)), toKobo(pricing.fullPurchaseFeeMax));
  return toNaira(Math.ceil(clamped / 10000) * 10000); // round up to the nearest ₦100
}

/** Suggested authorised limit: goods max + buffer %, rounded up to ₦500. */
export function suggestedLimit(goodsMax, pricing) {
  const k = Math.round(toKobo(goodsMax) * (1 + Number(pricing.authorizedLimitBufferPercent) / 100));
  return toNaira(Math.ceil(k / 50000) * 50000);
}
