export interface MyPointsSummary {
  /** Historical attendance audit total; use drawPoints for spendable game points. */
  totalPoints: number;
  ledgerScope?: 'attendance-audit';
  drawPoints?: { weekKey: string; rule: 'comprehensive-v1'; comprehensiveSeconds: number; earned: number; bonus: number; spent: number; balance: number };
}
