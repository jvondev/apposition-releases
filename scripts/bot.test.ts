import { describe, it, expect } from 'vitest';
import { batchEntries } from './bot';

describe('bot utilities', () => {
  describe('batchEntries', () => {
    it('should split an array into chunks of the specified size', () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const result = batchEntries(items, 5);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([1, 2, 3, 4, 5]);
      expect(result[1]).toEqual([6, 7]);
    });

    it('should return a single chunk if items are less than batch size', () => {
      const items = [1, 2, 3];
      const result = batchEntries(items, 5);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([1, 2, 3]);
    });

    it('should handle empty arrays', () => {
      const result = batchEntries([], 5);
      expect(result).toHaveLength(0);
    });
  });
});
