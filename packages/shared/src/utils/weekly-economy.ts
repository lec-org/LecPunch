/** One seconds-based calculation for rankings, assessment and draw eligibility. */
export function comprehensiveDurationSeconds(recorded: number, manual = 0, entertainment = 0): number {
  if (![recorded, manual, entertainment].every(Number.isSafeInteger) || recorded < 0) throw new Error('Invalid weekly duration');
  const adjusted = recorded + manual;
  const total = adjusted + entertainment;
  if (!Number.isSafeInteger(adjusted) || !Number.isSafeInteger(total)) throw new Error('Invalid weekly duration');
  return total;
}

export function weeklyDrawPoints(baseSeconds: number, entertainmentSeconds: number, spent: number) {
  if (!Number.isSafeInteger(spent) || spent < 0) throw new Error('Invalid spent points');
  // baseSeconds already includes signed manual adjustments; raw session durations remain non-negative.
  const comprehensiveSeconds = comprehensiveDurationSeconds(0, baseSeconds, entertainmentSeconds);
  const earned = Math.floor(comprehensiveSeconds / 60);
  const balance = earned - spent;
  if (!Number.isSafeInteger(balance)) throw new Error('Invalid draw points balance');
  return { rule: 'comprehensive-v1' as const, comprehensiveSeconds, earned, bonus: 0, spent, balance };
}
