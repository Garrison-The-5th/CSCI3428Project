/**
 * Island Game Randomizer
 *
 * Description: Builds a new random game each time the player starts or restarts.
 * - Each level gets a unique correct animal (no animal is the answer twice).
 * - Each level shows 3 options: the correct animal plus 2 wrong ones.
 * - Wrong options are taken from animals that have NOT already been a correct
 *   answer in an earlier level. If there are not enough of those left (we have
 *   7 animals and 7 levels), the remaining slots are filled with animals from
 *   earlier levels so every quiz still has 3 options.
 * - The order of the options is shuffled on every level.
 */

import type {Animal} from './island-data'

// Number of choices shown in each quiz (1 correct + 2 wrong)
const OPTIONS_PER_LEVEL = 3

export interface AnimalGame {
  // correctAnswers[level] is the animal the player must find on that level
  correctAnswers: Animal[]
  // levelOptions[level] is the shuffled list of choices for that level
  levelOptions: Animal[][]
}

/**
 * Fisher-Yates shuffle. Returns a new shuffled copy and leaves the input array unchanged.
 */
export function fisherYatesShuffle<T>(array: readonly T[]): T[] {
  const shuffledArray = [...array]

  for (let i = shuffledArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]]
  }

  return shuffledArray
}

/**
 * Generate the correct answers and quiz options for every level of a new game.
 *
 * @param allAnimals - every animal that can appear in the game
 * @param levelCount - how many levels the game has
 */
export function generateAnimalGame(allAnimals: readonly Animal[], levelCount: number): AnimalGame {
  if (levelCount > allAnimals.length) {
    throw new Error(
      `Island game needs at least ${levelCount} animals for ${levelCount} levels, but only ${allAnimals.length} exist.`
    )
  }
  if (allAnimals.length < OPTIONS_PER_LEVEL) {
    throw new Error(`Island game needs at least ${OPTIONS_PER_LEVEL} animals to build a quiz.`)
  }

  // Animals already used as correct answers
  const usedCorrectAnswers: Animal[] = []

  // Shuffle all animals, then pick one unique correct answer per level
  const shuffledAnimals = fisherYatesShuffle(allAnimals)
  const correctAnswers = shuffledAnimals.slice(0, levelCount)

  // Store options for every level
  const levelOptions: Animal[][] = []

  // Generate options for each level
  for (let level = 0; level < levelCount; level++) {
    // Get correct answer
    const correctAnswer = correctAnswers[level]

    // Find animals not previously used as a correct answer
    const availableAnimals = allAnimals.filter(
      animal => !usedCorrectAnswers.some(used => used.id === animal.id) && animal.id !== correctAnswer.id
    )

    // Fallback: animals that were correct answers on earlier levels.
    // Only used when there are not enough unused animals left.
    const fallbackAnimals = usedCorrectAnswers.filter(animal => animal.id !== correctAnswer.id)

    // Randomize incorrect answers, preferring unused animals first
    const wrongAnswers = [...fisherYatesShuffle(availableAnimals), ...fisherYatesShuffle(fallbackAnimals)].slice(
      0,
      OPTIONS_PER_LEVEL - 1
    )

    // Create the options and randomize their positions
    const currentOptions = [correctAnswer, ...wrongAnswers]
    levelOptions.push(fisherYatesShuffle(currentOptions))

    // Mark correct answer as used
    usedCorrectAnswers.push(correctAnswer)
  }

  return {correctAnswers, levelOptions}
}
