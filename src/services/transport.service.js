// Transport estimates by road. Legs (spec §6.5):
//   full purchase: base → market → customer → base
//   sample run:    base → market → base        (+ market → customer → base if samples are delivered)
// The operational base location stays on the server. Customers only ever see the naira estimate.
import { env } from '../config/env.js';
import { roundUpTo } from '../utils/money.js';

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Routing provider adapter: Google Distance Matrix when configured, otherwise straight line × road factor. */
async function roadKm(points) {
  const legs = points.slice(1).map((p, i) => [points[i], p]);
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      const results = await Promise.all(legs.map(async ([a, b]) => {
        const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
        url.searchParams.set('origins', `${a.lat},${a.lng}`);
        url.searchParams.set('destinations', `${b.lat},${b.lng}`);
        url.searchParams.set('mode', 'driving');
        url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        const el = data?.rows?.[0]?.elements?.[0];
        if (el?.status !== 'OK') throw new Error(`distance matrix: ${el?.status || data?.status}`);
        return el.distance.value / 1000;
      }));
      return { km: results, method: 'google_road' };
    } catch (err) {
      console.warn('road distance lookup failed, using estimate:', err.message);
    }
  }
  return { km: legs.map(([a, b]) => haversineKm(a, b) * env.ROAD_FACTOR), method: 'estimated' };
}

/**
 * @returns {{ cost: number, totalKm: number, method: string, legs: {from,to,km}[] }}
 */
export async function estimate({ base, market, customer, bookingType, deliveryRequired, pricing }) {
  const B = { label: 'Base', lat: Number(base.lat), lng: Number(base.lng) };
  const M = { label: market.name, lat: Number(market.lat), lng: Number(market.lng) };
  const C = customer?.lat != null ? { label: customer.label || 'Customer', lat: Number(customer.lat), lng: Number(customer.lng) } : null;

  const route = bookingType === 'full_purchase' || (deliveryRequired && C)
    ? (C ? [B, M, C, B] : [B, M, B])
    : [B, M, B];

  const { km, method } = await roadKm(route);
  const legs = km.map((k, i) => ({ from: route[i].label, to: route[i + 1].label, km: Math.round(k * 10) / 10 }));
  const totalKm = Math.round(km.reduce((a, b) => a + b, 0) * 10) / 10;
  const raw = Number(pricing.transportBaseFare) + totalKm * Number(pricing.transportPerKm);
  return { cost: roundUpTo(raw, Number(pricing.transportRoundTo) || 100), totalKm, method, legs };
}
