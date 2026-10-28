import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CardActionDto } from './card-action.dto';

describe('CardActionDto draw counts', () => {
  it.each([undefined, 1, 10])('accepts compatible single and ten draws: %s', async count => {
    expect(await validate(plainToInstance(CardActionDto, { requestKey: '00000000-0000-4000-8000-000000000001', action: 'draw', count }))).toEqual([]);
  });
  it.each([0, 2, 9, 11, -1, 1.5, '10'])('rejects invalid draw counts: %s', async count => {
    const errors = await validate(plainToInstance(CardActionDto, { requestKey: '00000000-0000-4000-8000-000000000001', action: 'draw', count }));
    expect(errors.some(error => error.property === 'count')).toBe(true);
  });
});
