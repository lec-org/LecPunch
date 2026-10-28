/** One seconds-based calculation for rankings, assessment and draw eligibility. */
export function comprehensiveDurationSeconds(recorded: number, manual = 0, entertainment = 0): number {
  if (![recorded, manual, entertainment].every(Number.isSafeInteger) || recorded < 0) throw new Error('Invalid weekly duration');
  const adjusted = recorded + manual;
  const total = Math.max(0, adjusted) + entertainment;
  if (!Number.isSafeInteger(adjusted) || !Number.isSafeInteger(total)) throw new Error('Invalid weekly duration');
  return total;
}

export function weeklyDrawPoints(baseSeconds: number, entertainmentSeconds: number, spent: number) {
  if (!Number.isSafeInteger(spent) || spent < 0) throw new Error('Invalid spent points');
  const comprehensiveSeconds = comprehensiveDurationSeconds(baseSeconds, 0, entertainmentSeconds);
  const earned = Math.max(0, Math.floor(comprehensiveSeconds / 60));
  return { rule: 'comprehensive-v1' as const, comprehensiveSeconds, earned, bonus: 0, spent, balance: Math.max(0, earned - spent) };
}
