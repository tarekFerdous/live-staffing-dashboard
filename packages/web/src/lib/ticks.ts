/** Most labels on the Y axis once it stops labelling every whole number. */
const MAX_TICKS = 6;

/**
 * Y axis tick values from 0 up to `top`: every whole number while `top` is 10 or less, otherwise
 * a "nice" step (2, 5, 10, 20, 50, …) giving at most six labels, so they never overlap.
 */
export function yTicks(top: number): number[] {
  const max = Math.max(0, Math.floor(top));
  let step = 1;
  if (max > 10) {
    for (let magnitude = 1; ; magnitude *= 10) {
      const nice = [1, 2, 5].map((m) => m * magnitude).find((s) => Math.floor(max / s) + 1 <= MAX_TICKS);
      if (nice) {
        step = nice;
        break;
      }
    }
  }
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}
