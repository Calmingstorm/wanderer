import { isReconciliationApplied } from './isReconciliationApplied';

describe('signature reconciliation acknowledgement', () => {
  it('accepts only the explicit applied acknowledgement', () => {
    expect(isReconciliationApplied({ result: 'applied', applied: true })).toBe(true);
    expect(isReconciliationApplied({ result: 'applied' })).toBe(false);
    expect(isReconciliationApplied({ applied: true })).toBe(false);
    expect(isReconciliationApplied({ result: 'stale', applied: false })).toBe(false);
    expect(isReconciliationApplied(undefined)).toBe(false);
    expect(isReconciliationApplied({})).toBe(false);
  });
});
