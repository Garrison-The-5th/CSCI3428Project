/**
 * Sentence Builder Game
 *
 * The player is shown a basic sentence in English and taps shuffled Mi'kmaq
 * word tiles (from the other games) to build it in the right order.
 * Tapping a tile plays its audio when a clip exists.
 *
 * Sentences are limited to the vocabulary learned up to the selected month.
 */

import {BackgroundImage, Button, Group, Paper, Progress, Select, Stack, Text, Title} from '@mantine/core'
import {useMemo, useState} from 'react'

import MatchingGameBackground from '@/assets/images/items/MatchingGameBackground.jpeg'
import {ScoreBeads} from '@/pages/matching-game/ScoreBeads'
import congratulatory from '@/assets/audio/matching-game-audio/congratulatory.mp3'
import tryAgain from '@/assets/audio/matching-game-audio/tryagain.mp3'
import {audioFor, LEVELS, SENTENCES, type Level, type Word} from './sentence-data'

type Tile = Word & {key: number}

// Fisher-Yates; `sort(() => Math.random() - 0.5)` is biased
const shuffle = <T,>(items: T[]) => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Shuffle until the bank is not already in the answer order */
const shuffleTiles = (tiles: Tile[]) => {
  let out = shuffle(tiles)
  while (tiles.length > 1 && out.every((t, i) => t.key === i)) out = shuffle(tiles)
  return out
}

const play = (src: string) => void new Audio(src).play().catch(() => {})

const sentencesFor = (level: Level) =>
  shuffle(SENTENCES.filter(s => LEVELS.indexOf(s.month) <= LEVELS.indexOf(level)))

const tileStyle = {height: 'auto', minHeight: 56, padding: '10px 22px', fontSize: '1.25rem', whiteSpace: 'normal'} as const

export function SentenceBuilderGame() {
  const [level, setLevel] = useState<Level>('March')
  const [order, setOrder] = useState(() => sentencesFor('March'))
  const [hints, setHints] = useState(0)
  const [round, setRound] = useState(0)
  const [built, setBuilt] = useState<Tile[]>([])
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null)
  const [score, setScore] = useState(0)

  const finished = round >= order.length
  const sentence = order[Math.min(round, order.length - 1)]

  // Shuffled bank for the current round; `key` keeps duplicate words distinct
  const bank = useMemo(() => shuffleTiles(sentence.tiles.map((word, key) => ({...word, key}))), [sentence])
  const remaining = bank.filter(t => !built.some(b => b.key === t.key))

  const check = () => {
    const correct = built.every((t, i) => t.mikmaq === sentence.tiles[i].mikmaq)
    setResult(correct ? 'correct' : 'wrong')
    play(correct ? congratulatory : tryAgain)
    if (correct) setScore(score + 1)
  }

  // Place the next correct tile, first returning any wrongly placed tiles
  const hint = () => {
    const correctPrefix = built.findIndex((t, i) => t.mikmaq !== sentence.tiles[i].mikmaq)
    const kept = correctPrefix === -1 ? built : built.slice(0, correctPrefix)
    const pool = bank.filter(t => !kept.some(k => k.key === t.key))
    const nextTile = pool.find(t => t.mikmaq === sentence.tiles[kept.length].mikmaq)
    if (!nextTile) return
    setBuilt([...kept, nextTile])
    setResult(null)
    setHints(hints + 1)
  }

  const reset = () => {
    setBuilt([])
    setResult(null)
  }

  const add = (tile: Tile) => {
    const audio = audioFor(tile)
    if (audio) play(audio)
    setBuilt([...built, tile])
    setResult(null)
  }

  const remove = (tile: Tile) => {
    setBuilt(built.filter(b => b.key !== tile.key))
    setResult(null)
  }

  const next = () => {
    setRound(round + 1)
    reset()
  }

  const start = (newLevel: Level) => {
    setLevel(newLevel)
    setOrder(sentencesFor(newLevel))
    setRound(0)
    setScore(0)
    setHints(0)
    reset()
  }

  return (
    <BackgroundImage
      h="var(--app-height)"
      src={MatchingGameBackground}
      p={{base: 'xs', sm: 'md', md: 'xl'}}
      style={{display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto'}}
    >
      <Paper
        bg="rgba(255, 255, 255, 0.9)"
        w={{base: '100%', md: 1000}}
        maw="100%"
        mah="100%"
        p={{base: 'md', md: 'xl'}}
        radius="xl"
        shadow="xl"
        style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', overflowY: 'auto'}}
      >
        <Stack gap="lg" align="center">
          <Stack gap="xs" w="100%" align="center">
            <Title order={1} ta="center">
              Sentence Builder
            </Title>
            <Text ta="center" c="dimmed" fs="italic">
              {finished ? 'All done!' : 'Build this sentence in Mi\'kmaq'}
            </Text>
            <Select
              aria-label="Vocabulary up to month"
              w={220}
              allowDeselect={false}
              data={LEVELS.map(m => ({value: m, label: `Words up to ${m}`}))}
              value={level}
              onChange={v => v && start(v as Level)}
            />
            <Progress
              w="100%"
              maw={400}
              size="md"
              radius="xl"
              color="bead.6"
              value={(Math.min(round, order.length) / order.length) * 100}
              aria-label="Progress"
            />
            <Text size="sm" c="dimmed">
              {Math.min(round + 1, order.length)} / {order.length}
            </Text>
          </Stack>

          {finished ? (
            <Stack align="center" gap="md" py="md" data-cy="sentence-finished">
              <Title order={2}>
                You built {score} of {order.length} sentences!
              </Title>
              <ScoreBeads score={score} />
              <Button size="lg" onClick={() => start(level)}>
                Play again
              </Button>
            </Stack>
          ) : (
            <>
              {score > 0 && <ScoreBeads score={score} />}

              <Title order={2} ta="center" data-cy="sentence-prompt">
                {sentence.english}
              </Title>

              {/* Answer area */}
              <Paper
                withBorder
                w="100%"
                mih={110}
                p="md"
                radius="lg"
                bg="white"
                style={{
                  borderStyle: 'dashed',
                  borderWidth: 2,
                  borderColor:
                    result === 'correct'
                      ? 'var(--mantine-color-green-6)'
                      : result === 'wrong'
                        ? 'var(--mantine-color-red-6)'
                        : undefined
                }}
              >
                <Group mih={76} gap="sm" justify="center" data-cy="sentence-answer">
                  {built.length === 0 && (
                    <Text c="dimmed" fs="italic">
                      Tap the words below
                    </Text>
                  )}
                  {built.map(t => (
                    <Button
                      key={t.key}
                      radius="xl"
                      variant="filled"
                      style={tileStyle}
                      disabled={result === 'correct'}
                      onClick={() => remove(t)}
                    >
                      {t.mikmaq}
                    </Button>
                  ))}
                </Group>
              </Paper>

              {/* Word bank */}
              <Group mih={76} gap="sm" justify="center" data-cy="sentence-bank">
                {remaining.map(t => (
                  <Button key={t.key} radius="xl" variant="default" style={tileStyle} onClick={() => add(t)}>
                    {t.mikmaq}
                  </Button>
                ))}
              </Group>

              <Text c={result === 'correct' ? 'green.8' : 'red.7'} fw={700} size="xl" mih={32} aria-live="polite">
                {result === 'correct' && 'Correct!'}
                {result === 'wrong' && 'Not quite, try again'}
              </Text>

              <Group>
                <Button size="lg" variant="light" disabled={result === 'correct'} onClick={hint}>
                  Hint
                </Button>
                <Button size="lg" variant="default" disabled={built.length === 0 || result === 'correct'} onClick={reset}>
                  Reset
                </Button>
                {result === 'correct' ? (
                  <Button size="lg" onClick={next}>
                    {round + 1 >= order.length ? 'Finish' : 'Next'}
                  </Button>
                ) : (
                  <Button size="lg" disabled={remaining.length > 0 || result === 'wrong'} onClick={check}>
                    Check
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Paper>
    </BackgroundImage>
  )
}
