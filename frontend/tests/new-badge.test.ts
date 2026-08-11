/**
 * File: new-badge.test.ts
 * Description: Tests for the New-marker roll-up rule.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { newMarkers } from '@/components/common/new-badge';

/**
 * The rule matters more than the pill. A newly published section arrives with
 * every module and element inside it also new, so tagging each one would put
 * New on twenty lines to say one thing. The tag goes at the highest level that
 * is new and stops there.
 *
 * Three readers share this — the learner's content rail, the quiz landing page
 * and the editor — so a drift here shows up in three places at once.
 */
describe('newMarkers', () => {
  it('marks nothing when there is nothing new', () => {
    const markers = newMarkers(null);

    expect(markers.any).toBe(false);
    expect(markers.section('s1')).toBe(false);
    expect(markers.module('m1', 's1')).toBe(false);
    expect(markers.item('e1', 'm1', 's1')).toBe(false);
  });

  it('treats undefined the same as nothing new', () => {
    expect(newMarkers(undefined).any).toBe(false);
  });

  it('marks a new section', () => {
    const markers = newMarkers({
      newSectionIds: ['s1'],
      newModuleIds: [],
      newElementIds: [],
      newQuizIds: [],
    });

    expect(markers.section('s1')).toBe(true);
    expect(markers.any).toBe(true);
  });

  /** The section heading already says it, so its modules stay unmarked. */
  it('suppresses a module marker when the whole section is new', () => {
    const markers = newMarkers({
      newSectionIds: ['s1'],
      newModuleIds: ['m1'],
      newElementIds: [],
      newQuizIds: [],
    });

    expect(markers.section('s1')).toBe(true);
    expect(markers.module('m1', 's1')).toBe(false);
  });

  it('suppresses an item marker when its section is new', () => {
    const markers = newMarkers({
      newSectionIds: ['s1'],
      newModuleIds: [],
      newElementIds: ['e1'],
      newQuizIds: [],
    });

    expect(markers.item('e1', 'm1', 's1')).toBe(false);
  });

  it('suppresses an item marker when its module is new', () => {
    const markers = newMarkers({
      newSectionIds: [],
      newModuleIds: ['m1'],
      newElementIds: ['e1'],
      newQuizIds: [],
    });

    expect(markers.module('m1', 's1')).toBe(true);
    expect(markers.item('e1', 'm1', 's1')).toBe(false);
  });

  it('marks an item when only that item is new', () => {
    const markers = newMarkers({
      newSectionIds: [],
      newModuleIds: [],
      newElementIds: ['e1'],
      newQuizIds: [],
    });

    expect(markers.item('e1', 'm1', 's1')).toBe(true);
    expect(markers.module('m1', 's1')).toBe(false);
  });

  it('treats a new quiz as an item', () => {
    const markers = newMarkers({
      newSectionIds: [],
      newModuleIds: [],
      newElementIds: [],
      newQuizIds: ['q1'],
    });

    expect(markers.item('q1', 'm1', 's1')).toBe(true);
  });

  it('marks a module in one section without affecting another', () => {
    const markers = newMarkers({
      newSectionIds: ['s2'],
      newModuleIds: ['m1'],
      newElementIds: [],
      newQuizIds: [],
    });

    // m1 sits in s1, which is not new, so it keeps its own marker.
    expect(markers.module('m1', 's1')).toBe(true);
    // A module in the new section is suppressed.
    expect(markers.module('m2', 's2')).toBe(false);
  });

  it('handles a module with no section without crashing', () => {
    const markers = newMarkers({
      newSectionIds: [],
      newModuleIds: ['m1'],
      newElementIds: [],
      newQuizIds: [],
    });

    expect(markers.module('m1', null)).toBe(true);
    expect(markers.item('e1', 'm1', null)).toBe(false);
  });
});
