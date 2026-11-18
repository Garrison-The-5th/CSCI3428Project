/**
 * User-defined flashcard tags, stored per browser in localStorage, keyed by word id.
 */
import type {Word} from '@/types'

export type Tags = Record<string, string[]>

const STORAGE_KEY = 'flashcard-tags'

export const loadTags = (): Tags => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const saveTags = (tags: Tags) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags))
  } catch {
    // storage unavailable (private mode, quota); tags just won't persist
  }
}

/** Returns the tags with one word's tags replaced; a word with no tags is removed. */
export const setWordTags = (tags: Tags, wordId: string, wordTags: string[]): Tags => {
  const rest = {...tags}
  delete rest[wordId]
  return wordTags.length ? {...rest, [wordId]: wordTags} : rest
}

/** Every tag in use, alphabetically. */
export const allTags = (tags: Tags) => [...new Set(Object.values(tags).flat())].sort()

/** Words that have at least one of the given tags; all words if none are given. */
export const filterByTags = (words: Word[], tags: Tags, selected: string[]) =>
  selected.length ? words.filter(word => tags[word.id]?.some(tag => selected.includes(tag))) : words
