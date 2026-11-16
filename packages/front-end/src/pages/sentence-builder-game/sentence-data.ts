/**
 * Sentence Builder Data
 *
 * Every tile below is the English translation of a word that already exists in
 * another game: either the Word Match words (packages/api/prisma/words/import-words.ts)
 * or the Island Game animals (island-data.ts). Keep sentences very basic.
 */

import { ANIMALS } from "@/pages/island-discover-game/island-data";

const animal = (id: string) => ANIMALS.find((a) => a.id === id)!.english;

export interface Sentence {
  id: number;
  /** Tiles in the correct order. Each one is an existing English translation. */
  tiles: string[];
}

export const SENTENCES: Sentence[] = [
  { id: 0, tiles: ["I like", animal("rabbit")] },
  { id: 1, tiles: ["I love", "Dad"] },
  { id: 2, tiles: ["I like", animal("bear"), "And", animal("moose")] },
  { id: 3, tiles: ["I love", animal("fox"), "And", animal("deer")] },
  { id: 4, tiles: ["I have it", animal("beaver")] },
];
