import { withTransaction } from '../db/pool.js';
import * as Address from '../models/address.model.js';
import * as Area from '../models/area.model.js';
import { badRequest, notFound } from '../utils/errors.js';

const MAX_ADDRESSES = 10;

/** Customer-facing address: the area name only, never coordinates. */
export function presentAddress(a) {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipient_name,
    recipientPhone: a.recipient_phone,
    addressLine: a.address_line,
    areaId: a.area_id,
    areaName: a.area_name,
    landmark: a.landmark,
    deliveryInstructions: a.delivery_instructions,
    isDefault: Boolean(a.is_default),
  };
}

export const list = async (customerId) => (await Address.listForCustomer(customerId)).map(presentAddress);

export async function getOwned(id, customerId, conn) {
  const a = await Address.findForCustomer(id, customerId, conn);
  if (!a) throw notFound('Address not found');
  return a;
}

async function assertArea(areaId) {
  const area = await Area.findById(areaId);
  if (!area || !area.active) throw badRequest('Choose your area from the list.', { fields: { areaId: 'Choose your area' } });
}

export async function create(customerId, body) {
  await assertArea(body.areaId);
  return withTransaction(async (conn) => {
    const count = await Address.countForCustomer(customerId, conn);
    if (count >= MAX_ADDRESSES) throw badRequest(`You can save up to ${MAX_ADDRESSES} addresses.`);
    const makeDefault = body.isDefault || count === 0;
    if (makeDefault) await Address.clearDefault(customerId, conn);
    const id = await Address.create(customerId, { ...body, isDefault: makeDefault }, conn);
    return presentAddress(await Address.findForCustomer(id, customerId, conn));
  });
}

export async function update(id, customerId, body) {
  await assertArea(body.areaId);
  return withTransaction(async (conn) => {
    await getOwned(id, customerId, conn);
    if (body.isDefault) await Address.clearDefault(customerId, conn);
    await Address.update(id, customerId, body, conn);
    return presentAddress(await Address.findForCustomer(id, customerId, conn));
  });
}

export async function remove(id, customerId) {
  await withTransaction(async (conn) => {
    const a = await getOwned(id, customerId, conn);
    await Address.archive(id, customerId, conn);
    if (a.is_default) {
      const rest = await Address.listForCustomer(customerId, conn);
      if (rest[0]) await Address.update(rest[0].id, customerId, {
        label: rest[0].label, recipientName: rest[0].recipient_name, recipientPhone: rest[0].recipient_phone,
        addressLine: rest[0].address_line, areaId: rest[0].area_id, landmark: rest[0].landmark,
        deliveryInstructions: rest[0].delivery_instructions, isDefault: true,
      }, conn);
    }
  });
}
