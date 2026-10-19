/**
 * Display label of a community (BR-13): `RT` + rt padded to 3 digits +
 * `/RW` + rw padded to 3 digits. Computed, never sent by a client.
 */
export function formatLabel(rt: number, rw: number): string {
  return `RT${String(rt).padStart(3, '0')}/RW${String(rw).padStart(3, '0')}`;
}
