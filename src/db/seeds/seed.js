// Starter data for Lagos. Safe to re-run (upserts by name/slug).
// ⚠ All prices are SAMPLE figures to show how fixed / range / open pricing works.
//   Jojo should replace them with her real market prices in Admin → Catalogue before launch.
// ⚠ Coordinates are approximate centre points, used only for rough transport estimates.
import { pool } from '../pool.js';

const AREAS = [
  ['Agege', 'Agege', 6.618, 3.32], ['Ajah', 'Eti-Osa', 6.4669, 3.5704], ['Apapa', 'Apapa', 6.448, 3.359],
  ['Badagry', 'Badagry', 6.417, 2.887], ['Chevron / Lekki', 'Eti-Osa', 6.439, 3.526], ['Ebute-Metta', 'Lagos Mainland', 6.485, 3.38],
  ['Egbeda', 'Alimosho', 6.592, 3.29], ['Epe', 'Epe', 6.584, 3.983], ['Festac Town', 'Amuwo-Odofin', 6.466, 3.283],
  ['Gbagada', 'Kosofe', 6.555, 3.389], ['Ibeju-Lekki', 'Ibeju-Lekki', 6.452, 3.85], ['Ikeja', 'Ikeja', 6.6018, 3.3515],
  ['Ikeja GRA', 'Ikeja', 6.58, 3.355], ['Ikorodu', 'Ikorodu', 6.6194, 3.5105], ['Ikotun', 'Alimosho', 6.548, 3.264],
  ['Ikoyi', 'Eti-Osa', 6.455, 3.434], ['Ilupeju', 'Mushin', 6.555, 3.359], ['Ipaja', 'Alimosho', 6.61, 3.265],
  ['Isolo', 'Oshodi-Isolo', 6.53, 3.32], ['Ketu', 'Kosofe', 6.596, 3.388], ['Lagos Island', 'Lagos Island', 6.4541, 3.3947],
  ['Lekki Phase 1', 'Eti-Osa', 6.4474, 3.472], ['Magodo', 'Kosofe', 6.615, 3.387], ['Maryland', 'Kosofe', 6.572, 3.366],
  ['Mushin', 'Mushin', 6.527, 3.354], ['Ogba', 'Ikeja', 6.627, 3.343], ['Ogudu', 'Kosofe', 6.579, 3.396],
  ['Ojo', 'Ojo', 6.463, 3.187], ['Ojodu', 'Ikeja', 6.64, 3.38], ['Oshodi', 'Oshodi-Isolo', 6.555, 3.343],
  ['Sangotedo', 'Eti-Osa', 6.47, 3.63], ['Surulere', 'Surulere', 6.5, 3.35], ['Victoria Island', 'Eti-Osa', 6.4281, 3.4219],
  ['Yaba', 'Lagos Mainland', 6.5095, 3.3711],
];

const CATEGORIES = [
  ['vegetables', 'Vegetables & fresh produce', '🍅', 1],
  ['grains', 'Rice, beans & grains', '🍚', 2],
  ['oils-seasoning', 'Oils, crayfish & seasoning', '🫙', 3],
  ['proteins', 'Fish, meat & eggs', '🐟', 4],
  ['fabrics', 'Fabrics & materials', '🧵', 5],
  ['clothing', 'Clothing & shoes', '👗', 6],
  ['plastics', 'Plastics & containers', '🪣', 7],
  ['household', 'Household goods', '🧺', 8],
];

const FOOD = ['vegetables', 'grains', 'oils-seasoning', 'proteins'];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const MARKETS = [
  { slug: 'mile-12', name: 'Mile 12 Market', area: 'Kosofe', lat: 6.6094, lng: 3.3964, days: MON_SAT, cats: FOOD,
    desc: 'Lagos’s biggest foodstuff market — tomatoes, pepper, onions, yams and grains by the basket and bag.' },
  { slug: 'oyingbo', name: 'Oyingbo Market', area: 'Ebute-Metta', lat: 6.4848, lng: 3.387, days: MON_SAT, cats: [...FOOD, 'household'],
    desc: 'Busy mainland market for fresh produce, grains, oils and everyday household items.' },
  { slug: 'balogun', name: 'Balogun Market', area: 'Lagos Island', lat: 6.456, lng: 3.3895, days: MON_SAT, cats: ['fabrics', 'clothing', 'household'],
    desc: 'Lagos Island’s fabric and fashion hub — Ankara, lace, Aso-oke, clothing and shoes.' },
  { slug: 'idumota', name: 'Idumota Market', area: 'Lagos Island', lat: 6.4596, lng: 3.3858, days: MON_SAT, cats: ['clothing', 'plastics', 'household'],
    desc: 'Wholesale-friendly market for clothing, plastics and general household goods.' },
  { slug: 'jankara', name: 'Jankara Market', area: 'Lagos Island', lat: 6.4617, lng: 3.3889, days: MON_SAT, cats: ['plastics', 'household', 'fabrics'],
    desc: 'Known for pots, plastics, containers and traditional household items.' },
  { slug: 'tejuosho', name: 'Tejuosho Market', area: 'Yaba', lat: 6.5065, lng: 3.3712, days: MON_SAT, cats: ['clothing', 'fabrics', 'household', 'vegetables'],
    desc: 'Yaba market for clothing, materials and household items, with a fresh produce section.' },
  { slug: 'ajah', name: 'Ajah Market', area: 'Ajah', lat: 6.4669, lng: 3.5704, days: MON_SAT, cats: [...FOOD, 'household'],
    desc: 'Lekki-side market for foodstuff and household shopping.' },
];

// [category, name, searchTerms, restockDays (one standard unit, household of 4), allowOpenAmount, options[]]
// option: [unitLabel, variant, priceType, price | [min,max] | null, isStandard]
const ITEMS = [
  ['vegetables', 'Tomatoes', 'tomato, tomatoe', 10, true, [['Basket', null, 'fixed', 20000, true], ['Paint bucket', null, 'fixed', 4500, false]]],
  ['vegetables', 'Fresh pepper', 'rodo, tatashe, shombo, scotch bonnet, pepper', 14, true, [['Basket', 'Rodo (scotch bonnet)', 'fixed', 18000, true], ['Basket', 'Tatashe (bell pepper)', 'fixed', 15000, false], ['Paint bucket', 'Mixed', 'fixed', 4000, false]]],
  ['vegetables', 'Onions', 'alubosa, onion', 21, true, [['Bag', null, 'fixed', 45000, true], ['Paint bucket', null, 'fixed', 3500, false]]],
  ['vegetables', 'Plantain', 'ogede, dodo', 7, true, [['Bunch', null, 'range', [4000, 9000], true]]],
  ['vegetables', 'Yam', 'isu, yam tuber', 10, true, [['Tuber', null, 'range', [2500, 8000], true]]],
  ['vegetables', 'Irish potatoes', 'potato, potatoes', 14, true, [['Paint bucket', null, 'fixed', 5000, true]]],
  ['vegetables', 'Okra', 'ila, okro', 5, true, [['Paint bucket', null, 'fixed', 3000, true]]],
  ['vegetables', 'Ugwu (pumpkin leaves)', 'ugu, fluted pumpkin', 4, true, [['By amount', null, 'none', null, false]]],
  ['vegetables', 'Efo / spinach', 'efo shoko, efo tete, spinach, green', 4, true, [['By amount', null, 'none', null, false]]],
  ['vegetables', 'Ginger & garlic', 'ata ile, ayu', 30, true, []],

  ['grains', 'Rice', 'iresi, rice', 60, true, [
    ['Bag (50kg)', 'Nigerian (local)', 'range', [70000, 85000], true], ['Bag (50kg)', 'Thai', 'range', [85000, 100000], false],
    ['Bag (50kg)', 'Chinese', 'range', [80000, 95000], false], ['Bag (50kg)', 'Basmati', 'range', [95000, 140000], false],
    ['Cup (mudu)', 'Nigerian (local)', 'range', [1800, 2500], false], ['Cup (mudu)', 'Basmati', 'range', [2500, 3500], false]]],
  ['grains', 'Beans', 'ewa, oloyin, honey beans, drum beans', 75, true, [
    ['Bag (50kg)', 'Oloyin (honey beans)', 'range', [90000, 120000], true], ['Bag (50kg)', 'Drum beans', 'range', [75000, 95000], false],
    ['Paint bucket', 'Oloyin (honey beans)', 'range', [9000, 12000], false], ['Cup (mudu)', 'Any', 'range', [2000, 3000], false]]],
  ['grains', 'Garri', 'gari, ijebu garri, yellow garri', 45, true, [['Bag (50kg)', 'White (Ijebu)', 'range', [35000, 50000], true], ['Paint bucket', 'White or yellow', 'range', [3500, 5000], false]]],
  ['grains', 'Egusi', 'melon seed, egusi', 30, true, [['Paint bucket', null, 'range', [9000, 14000], true], ['Cup (mudu)', null, 'range', [1800, 2800], false]]],

  ['oils-seasoning', 'Palm oil', 'epo pupa, red oil', 60, true, [['Keg (25L)', null, 'range', [45000, 60000], true], ['Keg (4L)', null, 'range', [8000, 11000], false]]],
  ['oils-seasoning', 'Vegetable oil', 'groundnut oil, oil', 60, true, [['Keg (25L)', null, 'range', [70000, 90000], true], ['Keg (5L)', null, 'range', [15000, 19000], false]]],
  ['oils-seasoning', 'Crayfish', 'ede, crayfish', 30, true, [['Paint bucket', null, 'range', [6000, 9000], true], ['By amount', null, 'none', null, false]]],
  ['oils-seasoning', 'Dried pepper & spices', 'ata gigun, spices, uda, iru, locust beans', 30, true, []],

  ['proteins', 'Frozen fish', 'titus, kote, mackerel, eja', 21, true, [['Carton', 'Titus (mackerel)', 'range', [55000, 75000], true], ['Carton', 'Kote (horse mackerel)', 'range', [45000, 60000], false]]],
  ['proteins', 'Stockfish & dried fish', 'panla, okporoko, eja kika', 30, true, []],
  ['proteins', 'Eggs', 'eyin, egg', 10, true, [['Crate (30)', null, 'fixed', 5500, true]]],
  ['proteins', 'Beef', 'eran, meat', 7, true, [['Kilogram', null, 'range', [6500, 8000], true]]],

  ['fabrics', 'Ankara', 'ankara, wax print, african print', null, true, [['6 yards', null, 'range', [12000, 30000], true], ['Per yard', null, 'range', [2000, 5000], false]]],
  ['fabrics', 'Lace', 'lace, cord lace, french lace', null, true, [['5 yards', null, 'range', [25000, 150000], true]]],
  ['fabrics', 'Aso-oke', 'aso oke, gele', null, true, []],
  ['fabrics', 'Plain material', 'plain, lining, cotton', null, true, [['Per yard', null, 'range', [1500, 4000], true]]],

  ['clothing', 'Ready-made dresses', 'gown, dress, boubou', null, true, [['Piece', null, 'range', [8000, 35000], true]]],
  ['clothing', 'Children’s clothing', 'kids clothes, baby clothes', null, true, []],
  ['clothing', 'Shoes & slippers', 'shoes, sandals, slippers', null, true, []],

  ['plastics', 'Buckets', 'bucket, pail', null, true, [['Piece', null, 'range', [2000, 8000], true]]],
  ['plastics', 'Bowls (set)', 'bowl, plastic bowls', null, true, [['Set', null, 'range', [5000, 15000], true]]],
  ['plastics', 'Food coolers', 'cooler, food flask, warmer', null, true, [['Piece', null, 'range', [25000, 80000], true]]],
  ['plastics', 'Storage containers', 'container, plastic container, drum', null, true, []],

  ['household', 'Toilet paper', 'tissue, toilet roll', 21, true, [['Pack (12 rolls)', null, 'range', [3500, 6000], true]]],
  ['household', 'Brooms', 'broom, igbale', null, true, [['Piece', null, 'fixed', 1500, true]]],
  ['household', 'Pots & cooking pots', 'pot, pots, cooking', null, true, []],
  ['household', 'Detergent & soap', 'omo, soap, detergent', 30, true, []],
];

async function upsertId(sqlFind, findArgs, sqlInsert, insertArgs, sqlUpdate, updateArgs) {
  const [rows] = await pool.query(sqlFind, findArgs);
  if (rows[0]) {
    if (sqlUpdate) await pool.query(sqlUpdate, [...updateArgs, rows[0].id]);
    return rows[0].id;
  }
  const [res] = await pool.query(sqlInsert, insertArgs);
  return res.insertId;
}

for (const [name, lga, lat, lng] of AREAS) {
  await pool.query(
    'INSERT INTO areas (name, lga, state, lat, lng) VALUES (?, ?, "Lagos", ?, ?) ON DUPLICATE KEY UPDATE lga = VALUES(lga), lat = VALUES(lat), lng = VALUES(lng)',
    [name, lga, lat, lng]);
}

const catIds = {};
for (const [slug, name, icon, sort] of CATEGORIES) {
  catIds[slug] = await upsertId('SELECT id FROM catalog_categories WHERE slug = ?', [slug],
    'INSERT INTO catalog_categories (slug, name, icon, sort) VALUES (?, ?, ?, ?)', [slug, name, icon, sort],
    'UPDATE catalog_categories SET name = ?, icon = ?, sort = ? WHERE id = ?', [name, icon, sort]);
}

for (const [i, m] of MARKETS.entries()) {
  const id = await upsertId('SELECT id FROM markets WHERE slug = ?', [m.slug],
    `INSERT INTO markets (slug, name, area, city, lat, lng, public_description, open_days, opens_at, closes_at, sort)
     VALUES (?, ?, ?, 'Lagos', ?, ?, ?, ?, '07:00', '18:00', ?)`, [m.slug, m.name, m.area, m.lat, m.lng, m.desc, JSON.stringify(m.days), i],
    null, null);
  await pool.query('DELETE FROM market_categories WHERE market_id = ?', [id]);
  await pool.query('INSERT INTO market_categories (market_id, category_id) VALUES ?', [m.cats.map((c) => [id, catIds[c]])]);
}

let itemCount = 0;
for (const [i, [cat, name, terms, restock, open, options]] of ITEMS.entries()) {
  const [existing] = await pool.query('SELECT id FROM catalog_items WHERE name = ? AND category_id = ?', [name, catIds[cat]]);
  if (existing[0]) continue; // don't overwrite prices Jojo has edited
  const [res] = await pool.query(
    'INSERT INTO catalog_items (category_id, name, search_terms, restock_days, allow_open_amount, sort) VALUES (?, ?, ?, ?, ?, ?)',
    [catIds[cat], name, terms, restock, open ? 1 : 0, i]);
  for (const [j, [unit, variant, type, price, standard]] of options.entries()) {
    const [p, min, max] = type === 'fixed' ? [price, null, null] : type === 'range' ? [null, price[0], price[1]] : [null, null, null];
    const [o] = await pool.query(
      `INSERT INTO catalog_item_options (item_id, unit_label, variant, price_type, price, price_min, price_max, allow_quantity, is_standard, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [res.insertId, unit, variant, type, p, min, max, type === 'none' ? 0 : 1, standard ? 1 : 0, j]);
    await pool.query('INSERT INTO option_price_history (option_id, price_type, price, price_min, price_max) VALUES (?, ?, ?, ?, ?)', [o.insertId, type, p, min, max]);
  }
  itemCount++;
}


// ---------- Jojo's Kitchen starter menu (SAMPLE prices — edit in Admin → Kitchen → Menu) ----------
// [slug, name, category, illustration, description, exclusions, spice, contains, featured, options[[label, serves, price, portions, bulk]]]
const STD = ['no_garlic', 'no_ginger', 'no_onions', 'no_seasoning_cubes', 'no_msg', 'low_salt', 'low_oil'];
const SOUP = [...STD, 'no_crayfish', 'no_palm_oil', 'no_beef', 'no_shellfish'];
const MEALS = [
  ['party-jollof', 'Smoky party jollof', 'rice', 'jollof', 'Long-grain rice slow-cooked in a rich tomato and tatashe base, finished over firewood heat for that bottom-pot smokiness.', STD, true, null, true,
    [['Plate', 'Serves 1', 3500, 1], ['Family tray', 'Serves 4–5', 15000, 5], ['Party cooler', 'Serves 20–25', 65000, 22, true]]],
  ['fried-rice', 'Nigerian fried rice', 'rice', 'friedrice', 'Curried rice with carrots, green beans, sweetcorn and liver, tossed in rich stock.', [...STD, 'no_beef'], true, null, false,
    [['Plate', 'Serves 1', 3500, 1], ['Family tray', 'Serves 4–5', 15000, 5], ['Party cooler', 'Serves 20–25', 65000, 22, true]]],
  ['ofada-ayamase', 'Ofada rice & ayamase', 'rice', 'ofada', 'Local ofada rice with green-pepper "designer stew", assorted meat and boiled egg — wrapped in leaves the old way.', [...STD, 'no_beef', 'no_crayfish'], true, 'Contains locust beans (iru)', true,
    [['Plate', 'Serves 1', 5000, 1.2], ['Family pack', 'Serves 4', 19000, 5]]],
  ['egusi', 'Egusi soup', 'soups', 'egusi', 'Ground melon seed soup with ugu and bitter leaf, stockfish, ponmo and assorted meat.', SOUP, true, 'Contains melon seeds, fish', true,
    [['1 litre', 'Serves 3–4', 12000, 3], ['2 litres', 'Serves 6–8', 22000, 6], ['5 litre bucket', 'Serves 18–20', 52000, 15, true]]],
  ['efo-riro', 'Efo riro', 'soups', 'eforiro', 'Rich spinach stew in a pepper and palm-oil base with iru, smoked fish and assorted meat.', SOUP, true, 'Contains fish, locust beans', false,
    [['1 litre', 'Serves 3–4', 11000, 3], ['2 litres', 'Serves 6–8', 20000, 6], ['5 litre bucket', 'Serves 18–20', 48000, 15, true]]],
  ['ogbono', 'Ogbono soup', 'soups', 'ogbono', 'Draw soup with ground ogbono, okra and leafy greens, loaded with beef and fish.', SOUP, true, 'Contains fish', false,
    [['1 litre', 'Serves 3–4', 11000, 3], ['2 litres', 'Serves 6–8', 20000, 6]]],
  ['banga', 'Banga soup', 'soups', 'banga', 'Palm-nut soup the Delta way, with fresh catfish and beletete spice.', SOUP.filter((x) => x !== 'no_palm_oil'), true, 'Contains fish', false,
    [['1 litre', 'Serves 3–4', 13000, 3], ['2 litres', 'Serves 6–8', 24000, 6]]],
  ['pepper-soup', 'Goat meat pepper soup', 'soups', 'peppersoup', 'Light, aromatic broth with uziza, scent leaf and tender goat meat. Catfish on request.', [...STD, 'no_beef'], true, null, false,
    [['Bowl', 'Serves 1', 4500, 1], ['2 litres', 'Serves 6', 22000, 6]]],
  ['pounded-yam', 'Pounded yam', 'swallow', 'poundo', 'Smooth, stretchy pounded yam made from fresh tubers — not flour.', [], false, null, false,
    [['Wrap', '1 wrap', 1200, 0.3], ['Pack of 6 wraps', '6 wraps', 6500, 1.5]]],
  ['amala', 'Amala', 'swallow', 'amala', 'Soft yam-flour amala, light and fluffy. Perfect with ewedu and gbegiri.', [], false, null, false,
    [['Wrap', '1 wrap', 800, 0.3], ['Pack of 6 wraps', '6 wraps', 4500, 1.5]]],
  ['eba', 'Eba', 'swallow', 'eba', 'Yellow garri eba, made just right — not too hard, not too soft.', [], false, null, false,
    [['Wrap', '1 wrap', 600, 0.2], ['Pack of 6 wraps', '6 wraps', 3300, 1]]],
  ['moi-moi', 'Moi moi', 'sides', 'moimoi', 'Steamed bean pudding with tatashe, egg and fish — soft, rich and peppery.', [...STD, 'no_crayfish'], true, 'Contains egg, fish', false,
    [['Piece', '1 wrap', 1200, 0.3], ['Dozen', '12 wraps', 13000, 3]]],
  ['dodo', 'Fried plantain (dodo)', 'sides', 'dodo', 'Sweet ripe plantain, sliced and fried golden.', ['low_oil'], false, null, false,
    [['Portion', 'Serves 1', 1500, 0.3], ['Party tray', 'Serves 15–20', 18000, 5, true]]],
  ['peppered-chicken', 'Peppered chicken', 'proteins', 'chicken', 'Seasoned, fried and tossed in a glossy pepper-onion sauce.', [...STD], true, null, true,
    [['2 pieces', 'Serves 1', 3500, 0.5], ['10 pieces', 'Serves 5', 16000, 2.5], ['Party tray (30 pcs)', 'Serves 15', 45000, 7, true]]],
  ['asun', 'Asun (spicy goat)', 'proteins', 'asun', 'Smoky grilled goat meat chopped and tossed with scotch bonnet and onions.', STD, true, null, false,
    [['Portion', 'Serves 1–2', 6000, 1], ['Party tray', 'Serves 15', 55000, 8, true]]],
  ['fish-stew', 'Fried fish & tomato stew', 'proteins', 'fishstew', 'Ayamase-style red stew with fried croaker or titus.', [...STD, 'no_palm_oil'], true, 'Contains fish', false,
    [['1 litre', 'Serves 3–4', 14000, 3], ['2 litres', 'Serves 6–8', 26000, 6]]],
  ['small-chops', 'Small chops box', 'small_chops', 'smallchops', 'Puff-puff, spring rolls, samosa, mosa and peppered gizzard — the party starter.', ['no_beef', 'low_oil'], true, 'Contains wheat, egg', true,
    [['Box', 'Serves 1', 3500, 0.6], ['Box of 20', '20 guests', 65000, 12, true], ['Box of 50', '50 guests', 155000, 28, true]]],
  ['akara', 'Akara', 'small_chops', 'akara', 'Crispy bean fritters with pepper and onion, fried to order.', ['no_onions', 'low_oil'], true, null, false,
    [['10 balls', 'Serves 2', 2000, 0.4], ['50 balls', 'Serves 10', 9000, 2]]],
  ['chin-chin', 'Chin chin', 'small_chops', 'chinchin', 'Crunchy, lightly sweet fried dough bites. Lasts for days.', [], false, 'Contains wheat, milk, egg', false,
    [['500g jar', '500g', 3500, 0.4], ['2kg bucket', '2kg', 12000, 1.5]]],
  ['party-pack', 'Party pack', 'party', 'partypack', 'Jollof or fried rice, chicken, moi moi, dodo and coleslaw in one sealed pack per guest.', STD, true, null, true,
    [['Pack of 25', '25 guests', 95000, 25, true], ['Pack of 50', '50 guests', 185000, 48, true], ['Pack of 100', '100 guests', 360000, 90, true]]],
];

let mealCount = 0;
for (const [i, [slug, name, category, illustration, description, excl, spice, contains, featured, options]] of MEALS.entries()) {
  const [found] = await pool.query('SELECT id FROM meals WHERE slug = ?', [slug]);
  if (found[0]) continue; // keep Jojo's edits
  const [res] = await pool.query(
    `INSERT INTO meals (slug, name, category, description, illustration, allowed_exclusions, spice_levels, contains, featured, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, [slug, name, category, description, illustration, JSON.stringify(excl), spice ? 1 : 0, contains, featured ? 1 : 0, i]);
  for (const [j, [label, serves, price, portions, bulk]] of options.entries()) {
    await pool.query('INSERT INTO meal_options (meal_id, label, serves, price, portions, is_bulk, active, sort) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      [res.insertId, label, serves, price, portions, bulk ? 1 : 0, j]);
  }
  mealCount++;
}

console.log(`Seeded ${AREAS.length} areas, ${CATEGORIES.length} categories, ${MARKETS.length} markets, ${itemCount} new items, ${mealCount} new dishes.`);
await pool.end();
