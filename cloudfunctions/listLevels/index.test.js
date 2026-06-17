/**
 * Unit tests for listLevels cloud function.
 *
 * The function queries the 'levels' collection filtered by the current user's
 * OPENID, returns selected fields, ordered by name ascending.
 */

// ── Mock wx-server-sdk ──────────────────────────────────────────────────────
const mockCollectionGet = jest.fn();
const mockCollectionField = jest.fn().mockReturnThis();
const mockCollectionOrderBy = jest.fn().mockReturnThis();
const mockCollectionWhere = jest.fn().mockReturnThis();
const mockCollection = jest.fn(() => ({
  where: mockCollectionWhere,
  field: mockCollectionField,
  orderBy: mockCollectionOrderBy,
  get: mockCollectionGet,
}));

const mockDB = {
  collection: mockCollection,
};

const mockGetWXContext = jest.fn();

jest.mock('wx-server-sdk', () => ({
  DYNAMIC_CURRENT_ENV: { dynamic: true },
  init: jest.fn(),
  getWXContext: (...args) => mockGetWXContext(...args),
  database: jest.fn(() => mockDB),
}));

// Import the module under test AFTER mocking
const cloud = require('wx-server-sdk');
const { main } = require('./index');

// ── Setup / Teardown ────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  // Default: a valid user context
  mockGetWXContext.mockReturnValue({ OPENID: 'user-abc-123' });
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function resolveGet(data) {
  mockCollectionGet.mockResolvedValue({ data });
}

function rejectGet(err) {
  mockCollectionGet.mockRejectedValue(err);
}

// ── Test Suite ──────────────────────────────────────────────────────────────
describe('listLevels cloud function', () => {
  // ── Normal / Happy Path ─────────────────────────────────────────────────

  describe('normal behaviour', () => {
    it('returns code 0 and data array on success', async () => {
      const levels = [
        { _id: 'lvl1', name: 'Level A', pigCount: 3, version: 1, updatedAt: '2026-01-01' },
        { _id: 'lvl2', name: 'Level B', pigCount: 5, version: 2, updatedAt: '2026-02-01' },
      ];
      resolveGet(levels);

      const result = await main({}, {});

      expect(result).toEqual({ code: 0, data: levels });
    });

    it('returns empty array when user has no levels', async () => {
      resolveGet([]);

      const result = await main({}, {});

      expect(result).toEqual({ code: 0, data: [] });
    });

    it('queries with the correct OPENID from context', async () => {
      mockGetWXContext.mockReturnValue({ OPENID: 'openid-xyz' });
      resolveGet([]);

      await main({}, {});

      expect(mockCollectionWhere).toHaveBeenCalledWith({ _openid: 'openid-xyz' });
    });

    it('selects only the expected fields', async () => {
      resolveGet([]);

      await main({}, {});

      expect(mockCollectionField).toHaveBeenCalledWith({
        _id: true,
        name: true,
        pigCount: true,
        version: true,
        updatedAt: true,
      });
    });

    it('orders by name ascending', async () => {
      resolveGet([]);

      await main({}, {});

      expect(mockCollectionOrderBy).toHaveBeenCalledWith('name', 'asc');
    });
  });

  // ── Error Handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns code -1 with error message on database failure', async () => {
      rejectGet(new Error('database connection lost'));

      const result = await main({}, {});

      expect(result).toEqual({ code: -1, msg: 'database connection lost' });
    });

    it('returns code -1 for a TypeError', async () => {
      rejectGet(new TypeError('Cannot read properties of undefined'));

      const result = await main({}, {});

      expect(result.code).toBe(-1);
      expect(result.msg).toBe('Cannot read properties of undefined');
    });

    it('returns code -1 with empty message for error without message property', async () => {
      // Simulate a non-standard error object (e.g. a plain object thrown)
      rejectGet({ code: 500 });

      const result = await main({}, {});

      expect(result).toEqual({ code: -1, msg: undefined });
    });

    it('returns code -1 when a string is thrown (non-Error)', async () => {
      // Some codebases throw plain strings
      rejectGet('something went wrong');

      const result = await main({}, {});

      // String has no .message, so result is undefined
      expect(result.code).toBe(-1);
      expect(result.msg).toBeUndefined();
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles OPENID being an empty string', async () => {
      mockGetWXContext.mockReturnValue({ OPENID: '' });
      resolveGet([]);

      const result = await main({}, {});

      expect(mockCollectionWhere).toHaveBeenCalledWith({ _openid: '' });
      expect(result).toEqual({ code: 0, data: [] });
    });

    it('handles OPENID being undefined', async () => {
      mockGetWXContext.mockReturnValue({});
      resolveGet([]);

      const result = await main({}, {});

      expect(mockCollectionWhere).toHaveBeenCalledWith({ _openid: undefined });
      expect(result).toEqual({ code: 0, data: [] });
    });

    it('handles getWXContext returning null', async () => {
      mockGetWXContext.mockReturnValue(null);
      // Destructuring null → OPENID is undefined
      resolveGet([]);

      // This should throw because destructuring null is not possible
      await expect(main({}, {})).rejects.toThrow();
    });

    it('handles a very large result set', async () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        _id: `id-${i}`,
        name: `Level ${i}`,
        pigCount: i % 10,
        version: 1,
        updatedAt: new Date().toISOString(),
      }));
      resolveGet(largeData);

      const result = await main({}, {});

      expect(result.code).toBe(0);
      expect(result.data).toHaveLength(1000);
    });

    it('handles result data containing unexpected extra fields', async () => {
      const levelsWithExtra = [
        { _id: 'x', name: 'X', pigCount: 2, version: 1, updatedAt: '...', rogue: 'field' },
      ];
      resolveGet(levelsWithExtra);

      const result = await main({}, {});

      // The function passes through whatever the DB returns
      expect(result.data[0].rogue).toBe('field');
      expect(result.code).toBe(0);
    });

    it('does not modify the event or context parameters', async () => {
      const event = { action: 'list' };
      const context = { memoryLimitInMB: 512 };
      resolveGet([]);

      await main(event, context);

      // event and context should be unchanged (the function ignores them)
      expect(event.action).toBe('list');
      expect(context.memoryLimitInMB).toBe(512);
    });

    it('calls cloud.init with DYNAMIC_CURRENT_ENV', () => {
      // Verify the module sets up init correctly
      // cloud.init is called at module scope
      expect(cloud.init).toHaveBeenCalledWith({ env: cloud.DYNAMIC_CURRENT_ENV });
    });
  });

  // ── Chain Integrity ──────────────────────────────────────────────────────

  describe('query chain', () => {
    it('calls the query chain in the correct order: where → field → orderBy → get', async () => {
      resolveGet([]);
      const order = [];

      mockCollectionWhere.mockImplementation(() => { order.push('where'); return mockCollectionWhere; });
      mockCollectionField.mockImplementation(() => { order.push('field'); return mockCollectionField; });
      mockCollectionOrderBy.mockImplementation(() => { order.push('orderBy'); return mockCollectionOrderBy; });
      mockCollectionGet.mockImplementation(() => { order.push('get'); return Promise.resolve({ data: [] }); });

      await main({}, {});

      expect(order).toEqual(['where', 'field', 'orderBy', 'get']);
    });
  });
});
