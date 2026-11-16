/**
 * File: new-badge.test.ts
 * Description: Tests for the New-marker roll-up rule.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { newMarkers } from '@/components/common/new-badge';

/**
 * The rule matters more than the pill. A newly published model arrives with
 * every section and quiz inside it also new, so tagging each one would put
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
    expect(markers.model('s1')).toBe(false);
    expect(markers.section('m1', 's1')).toBe(false);
    expect(markers.item('q1', 'm1', 's1')).toBe(false);
  });

  it('treats undefined the same as nothing new', () => {
    expect(newMarkers(undefined).any).toBe(false);
  });

  it('marks a new model', () => {
    const markers = newMarkers({
      newModelIds: ['s1'],
      newSectionIds: [],
      newQuizIds: [],
    });

    expect(markers.model('s1')).toBe(true);
    expect(markers.any).toBe(true);
  });

  /** The model heading already says it, so its sections stay unmarked. */
  it('suppresses a section marker when the whole model is new', () => {
    const markers = newMarkers({
      newModelIds: ['s1'],
      newSectionIds: ['m1'],
      newQuizIds: [],
    });

    expect(markers.model('s1')).toBe(true);
    expect(markers.section('m1', 's1')).toBe(false);
  });

  it('suppresses an item marker when its model is new', () => {
    const markers = newMarkers({
      newModelIds: ['s1'],
      newSectionIds: [],
      newQuizIds: ['q1'],
    });

    expect(markers.item('q1', 'm1', 's1')).toBe(false);
  });

  it('suppresses an item marker when its section is new', () => {
    const markers = newMarkers({
      newModelIds: [],
      newSectionIds: ['m1'],
      newQuizIds: ['q1'],
    });

    expect(markers.section('m1', 's1')).toBe(true);
    expect(markers.item('q1', 'm1', 's1')).toBe(false);
  });

  it('marks an item when only that item is new', () => {
    const markers = newMarkers({
      newModelIds: [],
      newSectionIds: [],
      newQuizIds: ['q1'],
    });

    expect(markers.item('q1', 'm1', 's1')).toBe(true);
    expect(markers.section('m1', 's1')).toBe(false);
  });

  /** A section is its own content, so the only item inside one is its quiz. */
  it('treats a new quiz as an item', () => {
    const markers = newMarkers({
      newModelIds: [],
      newSectionIds: [],
      newQuizIds: ['q1'],
    });

    expect(markers.item('q1', 'm1', 's1')).toBe(true);
  });

  it('marks a section in one model without affecting another', () => {
    const markers = newMarkers({
      newModelIds: ['s2'],
      newSectionIds: ['m1'],
      newQuizIds: [],
    });

    // m1 sits in s1, which is not new, so it keeps its own marker.
    expect(markers.section('m1', 's1')).toBe(true);
    // A section in the new model is suppressed.
    expect(markers.section('m2', 's2')).toBe(false);
  });

  it('handles a section with no model without crashing', () => {
    const markers = newMarkers({
      newModelIds: [],
      newSectionIds: ['m1'],
      newQuizIds: [],
    });

    expect(markers.section('m1', null)).toBe(true);
    expect(markers.item('q1', 'm1', null)).toBe(false);
  });
});
