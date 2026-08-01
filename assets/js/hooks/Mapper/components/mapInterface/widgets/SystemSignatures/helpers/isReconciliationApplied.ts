export type ReconciliationAcknowledgement = {
  result?: 'applied' | 'stale';
  applied?: boolean;
};

export const isReconciliationApplied = (response: ReconciliationAcknowledgement | null | undefined): boolean =>
  response?.result === 'applied' && response.applied === true;
