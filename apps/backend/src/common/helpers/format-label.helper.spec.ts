import { formatLabel } from './format-label.helper';

describe('formatLabel (BR-13)', () => {
  it('pads rt and rw to three digits', () => {
    expect(formatLabel(1, 6)).toBe('RT001/RW006');
    expect(formatLabel(12, 340)).toBe('RT012/RW340');
  });

  it('never exceeds three digits', () => {
    expect(formatLabel(999, 999)).toBe('RT999/RW999');
  });
});
