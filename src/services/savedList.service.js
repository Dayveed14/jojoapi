import { withTransaction } from '../db/pool.js';
import * as Booking from '../models/booking.model.js';
import * as Catalog from '../models/catalog.model.js';
import * as SavedList from '../models/savedList.model.js';
import { badRequest, notFound } from '../utils/errors.js';
import { money } from '../utils/money.js';
import { describeOptionPrice, optionLabel } from './pricing.service.js';

const MAX_LISTS = 20;

async function presentItems(rows) {
  const items = await Catalog.findItemsWithOptions([...new Set(rows.map((r) => r.catalog_item_id).filter(Boolean))]);
  return rows.map((r) => {
    const item = r.catalog_item_id ? items.get(r.catalog_item_id) : null;
    const opt = r.option_id ? item?.options.find((o) => o.id === r.option_id) : null;
    return {
      catalogItemId: r.catalog_item_id,
      optionId: r.option_id,
      customName: r.catalog_item_id ? null : r.item_name,
      itemName: item?.name || r.item_name,
      optionLabel: optionLabel(opt),
      currentPrice: opt ? describeOptionPrice(opt) : null, // today's price, not the old one
      available: !r.catalog_item_id || Boolean(item?.active && (!r.option_id || opt?.active)),
      requestMethod: r.request_method,
      quantity: r.quantity == null ? null : Number(r.quantity),
      amount: money(r.amount),
      preferences: r.preferences,
      allowSubstitution: Boolean(r.allow_substitution),
    };
  });
}

export async function list(customerId) {
  const rows = await SavedList.listForCustomer(customerId);
  return rows.map((l) => ({ id: l.id, name: l.name, marketId: l.market_id, marketName: l.market_name, itemCount: Number(l.item_count), updatedAt: l.updated_at }));
}

export async function get(id, customerId) {
  const l = await SavedList.findForCustomer(id, customerId);
  if (!l) throw notFound('List not found');
  return { id: l.id, name: l.name, marketId: l.market_id, items: await presentItems(await SavedList.listItems(l.id)) };
}

const toRows = (items) => items.map((i) => ({
  catalogItemId: i.catalogItemId ?? null, optionId: i.optionId ?? null, itemName: i.itemName || i.customName || 'Item',
  requestMethod: i.requestMethod, quantity: i.quantity ?? null, amount: i.amount ?? null, preferences: i.preferences, allowSubstitution: i.allowSubstitution,
}));

export async function save(id, customerId, body) {
  return withTransaction(async (conn) => {
    let listId = id;
    if (id) {
      if (!(await SavedList.findForCustomer(id, customerId, conn))) throw notFound('List not found');
      await SavedList.update(id, customerId, body, conn);
    } else {
      if ((await SavedList.listForCustomer(customerId, conn)).length >= MAX_LISTS) throw badRequest(`You can keep up to ${MAX_LISTS} lists.`);
      listId = await SavedList.create(customerId, body, conn);
    }
    // Item names for catalogue items come from the catalogue, not the browser.
    const catalog = await Catalog.findItemsWithOptions([...new Set(body.items.map((i) => i.catalogItemId).filter(Boolean))], conn);
    await SavedList.replaceItems(listId, toRows(body.items.map((i) => ({ ...i, itemName: i.catalogItemId ? catalog.get(i.catalogItemId)?.name : i.customName }))), conn);
    return listId;
  });
}

export async function saveFromBooking(reference, customerId, name) {
  const b = await Booking.findByReferenceForCustomer(reference, customerId);
  if (!b) throw notFound('Booking not found');
  const items = await Booking.listItems(b.id);
  return save(null, customerId, {
    name, marketId: b.market_id,
    items: items.map((i) => ({
      catalogItemId: i.catalog_item_id, optionId: i.option_id, customName: i.catalog_item_id ? null : i.item_name,
      requestMethod: i.request_method, quantity: i.quantity == null ? null : Number(i.quantity), amount: money(i.amount),
      preferences: i.preferences, allowSubstitution: Boolean(i.allow_substitution),
    })),
  });
}

export async function remove(id, customerId) {
  if (!(await SavedList.findForCustomer(id, customerId))) throw notFound('List not found');
  await SavedList.remove(id, customerId);
}
