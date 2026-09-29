export function movementPositions(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < -1 || to > 57 ||
      to <= from || to - from > 6) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
