/**
 * File: edit-lease-service.test.ts
 * Description: Unit tests for the advisory claims that stop two authors
 *   overwriting each other.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
import EditLeaseGateway from '@/gateways/edit-lease-gateway/edit-lease-gateway';
import EditLeaseService, { firstName } from '@/services/edit-lease-service/edit-lease-service';

jest.mock('@/gateways/edit-lease-gateway/edit-lease-gateway');

const mockGateway = EditLeaseGateway as jest.Mocked<typeof EditLeaseGateway>;

const ada = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' };
const grace = { id: 2, name: 'Grace Hopper', email: 'grace@example.com' };

beforeEach(() => jest.clearAllMocks());

/**
 * A lock says a name, and the name has to be one a colleague recognises. A full
 * name is more than a lock has room for and an address is not a name at all —
 * but an address is what some rows have, so it is the fallback rather than a
 * blank.
 */
describe('firstName', () => {
  it('takes the given name', () => {
    expect(firstName(ada)).toBe('Ada');
  });

  it.each([null, '', '   '])('falls back to the address for %p', (name) => {
    expect(firstName({ name, email: 'ada@example.com' })).toBe('ada@example.com');
  });
});

describe('claim', () => {
  it('grants a claim nobody else holds', async () => {
    mockGateway.claim.mockResolvedValue({ userId: 1, user: ada } as never);

    expect(await EditLeaseService.claim('c1', 'MODEL', 'm1', 1)).toMatchObject({
      granted: true,
      holder: 'Ada',
    });
  });

  /**
   * The refusal carries the holder's name, so the editor can draw the lock
   * without a second round trip asking who it belongs to.
   */
  it('refuses when somebody else holds it, and says who', async () => {
    mockGateway.claim.mockResolvedValue({ userId: 2, user: grace } as never);

    expect(await EditLeaseService.claim('c1', 'MODEL', 'm1', 1)).toMatchObject({
      granted: false,
      holder: 'Grace',
    });
  });

  /** A lapsed claim is anybody's, which is what the gateway's window decides. */
  it('passes a staleness cutoff to the gateway', async () => {
    mockGateway.claim.mockResolvedValue({ userId: 1, user: ada } as never);

    await EditLeaseService.claim('c1', 'QUESTION', 'q1', 1);

    const cutoff = mockGateway.claim.mock.calls[0][4];
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });
});

describe('listForCourse', () => {
  /**
   * Your own claims come back marked rather than filtered out: the editor needs
   * them to know which model it is still holding, and dropping them here would
   * have it fight itself for its own lock.
   */
  it('marks your own claims as yours', async () => {
    mockGateway.listLive.mockResolvedValue([
      { scope: 'MODEL', targetId: 'm1', userId: 1, user: ada },
      { scope: 'QUESTION', targetId: 'q1', userId: 2, user: grace },
    ] as never);

    const leases = await EditLeaseService.listForCourse('c1', 1);

    expect(leases).toEqual([
      { scope: 'MODEL', targetId: 'm1', userId: 1, holder: 'Ada', mine: true },
      { scope: 'QUESTION', targetId: 'q1', userId: 2, holder: 'Grace', mine: false },
    ]);
  });
});

describe('release', () => {
  /** Scoped to the holder, so one tab cannot drop somebody else's claim. */
  it('reports whether anything was actually given up', async () => {
    mockGateway.release.mockResolvedValue({ count: 0 } as never);
    expect(await EditLeaseService.release('MODEL', 'm1', 1)).toEqual({ released: false });

    mockGateway.release.mockResolvedValue({ count: 1 } as never);
    expect(await EditLeaseService.release('MODEL', 'm1', 1)).toEqual({ released: true });
  });
});
