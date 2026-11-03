/**
 * File: tour-service.test.ts
 * Description: Unit tests for storing a signed-in person's place in the
 *   first-login walkthrough.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { TOUR_STEP_COUNT } from '@/config/validation';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';
import TourService from '@/services/tour-service/tour-service';

jest.mock('@/gateways/auth-gateway/auth-gateway');
jest.mock('@/services/default-tutorial-service/default-tutorial-service');

const mockAuth = AuthGateway as jest.Mocked<typeof AuthGateway>;
const mockTutorial = DefaultTutorialService as jest.Mocked<typeof DefaultTutorialService>;

beforeEach(() => {
  jest.clearAllMocks();
  mockTutorial.id.mockResolvedValue('tutorial');
  mockAuth.setTour.mockImplementation(((_id: number, tourStatus: string, tourStep: number) =>
    Promise.resolve({ tourStatus, tourStep })) as never);
});

describe('TourService.get', () => {
  /** A brand-new account is what "first login" means: NOT_STARTED, at the top. */
  it('reports a new account as not started, with the course the tour leads into', async () => {
    mockAuth.getTour.mockResolvedValue({ tourStatus: 'NOT_STARTED', tourStep: 0 } as never);

    expect(await TourService.get(1)).toEqual({
      status: 'NOT_STARTED',
      step: 0,
      tutorialCourseId: 'tutorial',
    });
  });

  it('reports where somebody part way through stopped', async () => {
    mockAuth.getTour.mockResolvedValue({ tourStatus: 'IN_PROGRESS', tourStep: 9 } as never);

    expect(await TourService.get(1)).toMatchObject({ status: 'IN_PROGRESS', step: 9 });
  });
});

describe('TourService.save', () => {
  it('stores a valid status and step', async () => {
    await TourService.save(1, { status: 'IN_PROGRESS', step: 4 });

    expect(mockAuth.setTour).toHaveBeenCalledWith(1, 'IN_PROGRESS', 4);
  });

  /** Replay is not a route of its own — it is this write. */
  it('replays by going back to IN_PROGRESS at the first step', async () => {
    await TourService.save(1, { status: 'IN_PROGRESS', step: 0 });

    expect(mockAuth.setTour).toHaveBeenCalledWith(1, 'IN_PROGRESS', 0);
  });

  it.each(['COMPLETED', 'SKIPPED'])('remembers %s', async (status) => {
    await TourService.save(1, { status, step: 3 });

    expect(mockAuth.setTour).toHaveBeenCalledWith(1, status, 3);
  });

  it('accepts the last step of the script', async () => {
    await TourService.save(1, { status: 'COMPLETED', step: TOUR_STEP_COUNT - 1 });

    expect(mockAuth.setTour).toHaveBeenCalledWith(1, 'COMPLETED', TOUR_STEP_COUNT - 1);
  });

  /**
   * A step past the end would be stored and then resumed into a step that does
   * not exist, so it is refused rather than clamped.
   */
  it.each([
    ['past the end', TOUR_STEP_COUNT],
    ['negative', -1],
    ['fractional', 2.5],
    ['not a number', 'three'],
  ])('refuses a step that is %s', async (_label, step) => {
    await expect(TourService.save(1, { status: 'IN_PROGRESS', step })).rejects.toThrow(/step/);
    expect(mockAuth.setTour).not.toHaveBeenCalled();
  });

  /** Missing is not 0 — that would quietly send somebody back to the start. */
  it('refuses a missing step', async () => {
    await expect(TourService.save(1, { status: 'IN_PROGRESS' })).rejects.toThrow(
      'step is required',
    );
  });

  it.each([['FINISHED'], [''], [undefined], [3]])('refuses the status %p', async (status) => {
    await expect(TourService.save(1, { status, step: 0 })).rejects.toThrow(/status must be/);
    expect(mockAuth.setTour).not.toHaveBeenCalled();
  });

  it('refuses a body that is not an object', async () => {
    await expect(TourService.save(1, null)).rejects.toThrow(/status must be/);
  });
});
