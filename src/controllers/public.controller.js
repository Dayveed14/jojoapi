import * as availabilityService from '../services/availability.service.js';
import * as catalogService from '../services/catalog.service.js';
import * as settingsService from '../services/settings.service.js';

export async function markets(_req, res) {
  res.json({ items: await catalogService.publicMarkets() });
}

export async function marketCatalog(req, res) {
  res.json(await catalogService.marketCatalog(Number(req.params.id)));
}

export async function areas(_req, res) {
  res.json({ items: await catalogService.listAreas() });
}

export async function serviceInfo(_req, res) {
  res.json(await settingsService.publicSettings());
}

export async function availability(req, res) {
  const { bookingType, marketId } = req.validatedQuery;
  const market = marketId ? await catalogService.getActiveMarket(marketId) : null;
  res.json({ days: await availabilityService.calendar({ bookingType, market }) });
}
