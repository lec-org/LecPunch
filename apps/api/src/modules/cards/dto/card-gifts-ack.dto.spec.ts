import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CardGiftsAckDto } from './card-gifts-ack.dto';
describe('gift notice acknowledgement DTO', () => {
  it('accepts the stable notice identifiers', () => {
    expect(validateSync(plainToInstance(CardGiftsAckDto, { ids: ['a'.repeat(64)] }))).toHaveLength(0);
  });
  it.each([{}, { ids: [] }, { ids: ['invalid'] }, { ids: Array(21).fill('a'.repeat(64)) }, { ids: 'a'.repeat(64) }])('rejects invalid identifiers %j', input => {
    expect(validateSync(plainToInstance(CardGiftsAckDto, input)).length).toBeGreaterThan(0);
  });
});
