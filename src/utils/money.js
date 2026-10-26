// All arithmetic is done in kobo (integers) to avoid floating-point errors.
// The database stores DECIMAL(12,2) naira; mysql2 returns those as strings.

export const toKobo = (naira) => (naira == null || naira === '' ? 0 : Math.round(Number(naira) * 100));
export const toNaira = (kobo) => Math.round(kobo) / 100;

/** Normalise any DB/JSON money value to a number of naira with 2 dp (or null). */
export const money = (v) => (v == null ? null : toNaira(toKobo(v)));

export const sumKobo = (values) => values.reduce((acc, v) => acc + toKobo(v), 0);

/** Round naira up to the nearest step (e.g. ₦100) — used for transport estimates. */
export const roundUpTo = (naira, step = 100) => Math.ceil(Number(naira) / step) * step;

export const formatNaira = (v) =>
  `₦${Number(v || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
