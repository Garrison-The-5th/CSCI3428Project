/**
 * Spaced repetition (Leitner boxes) for flashcard review.
 * Progress is stored per browser in localStorage, keyed by word id.
 */
import type {Word} from '@/types'

export type CardProgress = {box: number; due: number}
export type Progress = Record<string, CardProgress>

const STORAGE_KEY = 'flashcard-progress'
const DAY = 24 * 60 * 60 * 1000

// Days to wait before a card in each box is shown again. A new or missed card is in box 0 and is due immediately.
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30]
export const MAX_BOX = INTERVAL_DAYS.length - 1

export const loadProgress = (): Progress => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const saveProgress = (progress: Progress) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // storage unavailable (private mode, quota); progress just won't persist
  }
}

/** Returns the progress after answering a card: a correct answer moves it up a box, a miss sends it back to box 0. */
export const grade = (progress: Progress, wordId: string, correct: boolean, now = Date.now()): Progress => {
  const box = correct ? Math.min((progress[wordId]?.box ?? 0) + 1, MAX_BOX) : 0
  return {
    ...progress,
    [wordId]: {box, due: now + INTERVAL_DAYS[box] * DAY}
  }
}

/** Words that are new or due, most overdue first. */
export const dueWords = (words: Word[], progress: Progress, now = Date.now()) =>
  words
    .filter(word => (progress[word.id]?.due ?? 0) <= now)
    .sort((a, b) => (progress[a.id]?.due ?? 0) - (progress[b.id]?.due ?? 0))

/** When the next card becomes due, or null if nothing is scheduled. */
export const nextDue = (progress: Progress, now = Date.now()) => {
  const upcoming = Object.values(progress)
    .map(card => card.due)
    .filter(due => due > now)
  return upcoming.length ? Math.min(...upcoming) : null
}
