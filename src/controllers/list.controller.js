// Saved shopping lists + restocking estimates (customer)
import * as restockService from '../services/restock.service.js';
import * as savedListService from '../services/savedList.service.js';

export async function lists(req, res) {
  res.json({ items: await savedListService.list(req.user.id) });
}
export async function getList(req, res) {
  res.json({ list: await savedListService.get(Number(req.params.id), req.user.id) });
}
export async function createList(req, res) {
  const id = await savedListService.save(null, req.user.id, req.body);
  res.status(201).json({ list: await savedListService.get(id, req.user.id) });
}
export async function updateList(req, res) {
  const id = await savedListService.save(Number(req.params.id), req.user.id, req.body);
  res.json({ list: await savedListService.get(id, req.user.id) });
}
export async function deleteList(req, res) {
  await savedListService.remove(Number(req.params.id), req.user.id);
  res.status(204).end();
}

export async function restocking(req, res) {
  res.json({ items: await restockService.listForCustomer(req.user.id) });
}
export async function updateRestock(req, res) {
  res.json({ item: await restockService.update(req.user.id, Number(req.params.id), req.body) });
}
