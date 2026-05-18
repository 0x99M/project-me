export function formatCompact(n: number, decimals = 1): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);

  const tiers = [
    { value: 1e12, sym: 'T' },
    { value: 1e9, sym: 'B' },
    { value: 1e6, sym: 'M' },
    { value: 1e3, sym: 'K' },
  ];

  for (const t of tiers) {
    if (n >= t.value) {
      const scaled = n / t.value;
      // keep integers when they are “round”, otherwise respect decimals
      const fixed = scaled === Math.floor(scaled)
        ? String(Math.floor(scaled))
        : scaled.toFixed(decimals);
      return sign + fixed + t.sym;
    }
  }
  return sign + n.toFixed(decimals);
}