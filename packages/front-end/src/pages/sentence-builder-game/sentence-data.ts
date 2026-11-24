/**
 * Sentence Builder Data
 *
 * Every tile below is the English translation of a word that already exists in
 * another game: either the Word Match words (packages/api/prisma/words/import-words.ts)
 * or the Island Game animals (island-data.ts). Keep sentences very basic.
 */

import { ANIMALS } from "@/pages/island-discover-game/island-data";

const animal = (id: string) => ANIMALS.find((a) => a.id === id)!.english;

export const LEVELS = ["September", "October", "November", "December", "January", "February", "March"] as const;
export type Level = (typeof LEVELS)[number];

/** Month each non-animal tile's word is introduced in the Word Match game */
const WORD_MONTHS: Record<string, Level> = {
  "And": "October",
  "I love": "November",
  "I like": "December",
  "I see it": "December",
  "Dad": "January",
  "Mother / Grandmother": "January",
  "I have it": "February",
  "Look at this": "February",
  "I am happy": "March",
};

export interface Sentence {
  id: number;
  /** Tiles in the correct order. Each one is an existing English translation. */
  tiles: string[];
  /** Latest month of vocabulary used; animals are available from the start */
  month: Level;
}

const RAW_SENTENCES: Omit<Sentence, "month">[] = [
  { id: 0, tiles: ["I like", animal("rabbit")] },
  { id: 1, tiles: ["I love", "Dad"] },
  { id: 2, tiles: ["I love", "Mother / Grandmother"] },
  { id: 3, tiles: ["I see it", animal("moose")] },
  { id: 4, tiles: ["Look at this", animal("raccoon")] },
  { id: 5, tiles: ["I like", animal("bear"), "And", animal("moose")] },
  { id: 6, tiles: ["I love", animal("fox"), "And", animal("deer")] },
  { id: 7, tiles: ["I have it", animal("beaver")] },
  { id: 8, tiles: ["I love", "Dad", "And", "Mother / Grandmother"] },
  { id: 9, tiles: ["I see it", animal("fox"), "And", animal("rabbit")] },
  { id: 10, tiles: ["I am happy", "And", "I love", "Dad"] },
  { id: 11, tiles: ["I like", animal("raccoon"), "And", animal("beaver")] },
];

const monthOf = (tiles: string[]): Level =>
  tiles.reduce<Level>((latest, t) => {
    const m = WORD_MONTHS[t] ?? LEVELS[0];
    return LEVELS.indexOf(m) > LEVELS.indexOf(latest) ? m : latest;
  }, LEVELS[0]);

export const SENTENCES: Sentence[] = RAW_SENTENCES.map((s) => ({ ...s, month: monthOf(s.tiles) }));
