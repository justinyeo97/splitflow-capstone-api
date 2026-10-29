const RATE_SCALE = 12;
export function decimal(value, scale = 8) {
  const s = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("Invalid decimal");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > scale)
    throw new Error(`Maximum precision is ${scale} decimal places`);
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt((frac + "0".repeat(scale)).slice(0, scale)) *
      (whole.startsWith("-") ? -1n : 1n)
  );
}
export function multiplyAndRound(amount, rate, places = 2) {
  const a = decimal(amount, 8),
    r = decimal(rate, RATE_SCALE),
    divisor = 10n ** BigInt(8 + RATE_SCALE - places);
  let numerator = a * r;
  const negative = numerator < 0n;
  if (negative) numerator = -numerator;
  let rounded = numerator / divisor;
  if ((numerator % divisor) * 2n >= divisor) rounded++;
  if (negative) rounded = -rounded;
  const unit = 10n ** BigInt(places),
    abs = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? "-" : ""}${abs / unit}.${String(abs % unit).padStart(places, "0")}`;
}
export function identityRate(from, to) {
  return from === to ? "1.00000000" : null;
}
