// Markets, categories, items and buying options. Prices are data the operator edits — never hardcoded.
import { withTransaction } from '../db/pool.js';
import * as Area from '../models/area.model.js';
import * as Catalog from '../models/catalog.model.js';
import * as Market from '../models/market.model.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { money } from '../utils/money.js';
import * as auditService from './audit.service.js';
import { describeOptionPrice, optionLabel } from './pricing.service.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (t) => String(t).slice(0, 5);

// ---------- Public shapes (no internal notes, no coordinates) ----------

export function presentMarket(m, categories = []) {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    area: m.area,
    city: m.city,
    description: m.public_description,
    openDays: m.open_days,
    openDaysLabel: m.open_days.length === 7 ? 'Every day' : m.open_days.map((d) => DAY[d]).join(', '),
    hours: `${hhmm(m.opens_at)}–${hhmm(m.closes_at)}`,
    categories: categories.filter((c) => m.category_ids.includes(c.id)).map((c) => ({ id: c.id, name: c.name, icon: c.icon, slug: c.slug })),
  };
}

export function presentOption(o) {
  return {
    id: o.id,
    unitLabel: o.unit_label,
    variant: o.variant,
    label: optionLabel(o),
    price: describeOptionPrice(o),
    allowQuantity: o.price_type !== 'none' && Boolean(o.allow_quantity),
    isStandard: Boolean(o.is_standard),
    priceUpdatedAt: o.price_updated_at,
  };
}

export function presentItem(i) {
  return {
    id: i.id,
    name: i.name,
    description: i.description,
    searchTerms: i.search_terms,
    categoryId: i.category_id,
    categoryName: i.category_name,
    categoryIcon: i.category_icon,
    allowOpenAmount: Boolean(i.allow_open_amount),
    allowSubstitutions: Boolean(i.allow_substitutions),
    options: i.options.map(presentOption),
  };
}

export async function publicMarkets() {
  const [markets, categories] = await Promise.all([Market.list(), Catalog.listCategories()]);
  return markets.map((m) => presentMarket(m, categories));
}

export async function getActiveMarket(id) {
  const m = await Market.findById(id);
  if (!m || !m.active) throw notFound('That market is not available.');
  return m;
}

/** Items a market can be asked for (filtered by the categories it supports). */
export async function marketCatalog(marketId) {
  const market = await getActiveMarket(marketId);
  const categories = await Catalog.listCategories();
  const items = await Catalog.listItems({ categoryIds: market.category_ids });
  return {
    market: presentMarket(market, categories),
    categories: categories.filter((c) => market.category_ids.includes(c.id)).map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    items: items.map(presentItem),
  };
}

export const listAreas = () => Area.listActive();

// ---------- Operator: admin shapes include everything ----------

export async function adminCatalog() {
  const [categories, items, markets] = await Promise.all([
    Catalog.listCategories({ includeInactive: true }),
    Catalog.listItems({ includeInactive: true }),
    Market.list({ includeInactive: true }),
  ]);
  return {
    categories,
    markets: markets.map((m) => ({ ...m, lat: Number(m.lat), lng: Number(m.lng), opens_at: hhmm(m.opens_at), closes_at: hhmm(m.closes_at) })),
    items: items.map((i) => ({
      ...i,
      options: i.options.map((o) => ({ ...o, price: money(o.price), price_min: money(o.price_min), price_max: money(o.price_max) })),
    })),
  };
}

function normaliseOption(o) {
  if (o.priceType === 'fixed') {
    if (!(o.price > 0)) throw badRequest(`Enter a price for "${o.unitLabel}".`);
    return { ...o, priceMin: null, priceMax: null };
  }
  if (o.priceType === 'range') {
    if (!(o.priceMin > 0) || !(o.priceMax >= o.priceMin)) throw badRequest(`Enter a valid price range for "${o.unitLabel}" (max must be at least min).`);
    return { ...o, price: null };
  }
  return { ...o, price: null, priceMin: null, priceMax: null, allowQuantity: false };
}

const priceSig = (o) => `${o.priceType ?? o.price_type}|${money(o.price)}|${money(o.priceMin ?? o.price_min)}|${money(o.priceMax ?? o.price_max)}`;

/** Create or update an item and its options in one go, keeping price history. */
export async function saveItem(id, body, user, ip) {
  return withTransaction(async (conn) => {
    let itemId = id;
    const existing = id ? await Catalog.findItem(id, conn) : null;
    if (id && !existing) throw notFound('Item not found');

    if (existing) await Catalog.updateItem(id, body, conn);
    else itemId = await Catalog.createItem(body, conn);

    const options = (body.options || []).map(normaliseOption);
    if (options.filter((o) => o.isStandard).length > 1) throw badRequest('Only one option can be the standard unit.');
    if (options.some((o) => o.isStandard)) await Catalog.clearStandard(itemId, conn);

    for (const o of options) {
      if (o.id) {
        const prev = existing?.options.find((x) => x.id === o.id);
        if (!prev) throw badRequest('Option does not belong to this item.');
        const changed = priceSig(prev) !== priceSig(o);
        await Catalog.updateOption(o.id, o, user.id, changed, conn);
        if (changed) await Catalog.insertPriceHistory(o.id, o, user.id, conn);
      } else {
        const newId = await Catalog.createOption(itemId, o, user.id, conn);
        await Catalog.insertPriceHistory(newId, o, user.id, conn);
      }
    }
    // Options removed from the form are deactivated, never deleted (old bookings reference them).
    const keep = new Set(options.filter((o) => o.id).map((o) => o.id));
    for (const prev of existing?.options || []) {
      if (!keep.has(prev.id) && prev.active) await Catalog.updateOption(prev.id, {
        unitLabel: prev.unit_label, variant: prev.variant, priceType: prev.price_type, price: prev.price, priceMin: prev.price_min,
        priceMax: prev.price_max, allowQuantity: prev.allow_quantity, isStandard: false, sort: prev.sort, active: false,
      }, user.id, false, conn);
    }

    await auditService.record({ actorUserId: user.id, action: existing ? 'catalog.item_updated' : 'catalog.item_created', entityType: 'catalog_item', entityId: itemId, metadata: { name: body.name }, ip }, conn);
    return Catalog.findItem(itemId, conn);
  });
}

export async function saveCategory(id, body, user, ip) {
  try {
    if (id) await Catalog.updateCategory(id, body);
    else id = await Catalog.createCategory(body);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('A category with that short name already exists.');
    throw err;
  }
  await auditService.record({ actorUserId: user.id, action: 'catalog.category_saved', entityType: 'category', entityId: id, ip });
  return id;
}

export async function saveMarket(id, body, user, ip) {
  try {
    return await withTransaction(async (conn) => {
      if (id) {
        if (!(await Market.findById(id, conn))) throw notFound('Market not found');
        await Market.update(id, body, conn);
      } else {
        id = await Market.create(body, conn);
      }
      await Market.setCategories(id, body.categoryIds, conn);
      await auditService.record({ actorUserId: user.id, action: 'market.saved', entityType: 'market', entityId: id, metadata: { name: body.name }, ip }, conn);
      return id;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('A market with that short name already exists.');
    throw err;
  }
}
