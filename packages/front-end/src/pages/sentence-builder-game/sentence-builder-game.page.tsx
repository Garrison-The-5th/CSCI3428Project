/**
 * Sentence Builder Game (skeleton)
 *
 * The player taps shuffled word tiles to build a very basic sentence in the
 * right order. Tiles are English translations of words from the other games.
 *
 * TODO: Mik'maq display/audio on tiles, win popup, level select.
 */

import {BackgroundImage, Button, Group, Paper, Stack, Text, Title} from '@mantine/core'
import {useMemo, useState} from 'react'

import MatchingGameBackground from '@/assets/images/items/MatchingGameBackground.jpeg'
import {ScoreBeads} from '@/pages/matching-game/ScoreBeads'
import {SENTENCES} from './sentence-data'

type Tile = {key: number; text: string}

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5)

export function SentenceBuilderGame() {
  const [round, setRound] = useState(0)
  const [built, setBuilt] = useState<Tile[]>([])
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null)
  const [score, setScore] = useState(0)

  const sentence = SENTENCES[round]

  // Shuffled bank for the current round; `key` keeps duplicate words distinct
  const bank = useMemo(() => shuffle(sentence.tiles.map((text, key) => ({key, text}))), [sentence])
  const remaining = bank.filter(t => !built.some(b => b.key === t.key))

  const check = () => {
    const correct = built.every((t, i) => t.text === sentence.tiles[i])
    setResult(correct ? 'correct' : 'wrong')
    if (correct) setScore(score + 1)
  }

  const reset = () => {
    setBuilt([])
    setResult(null)
  }

  const next = () => {
    setRound((round + 1) % SENTENCES.length)
    reset()
  }

  return (
    <BackgroundImage
      h="var(--app-height)"
      src={MatchingGameBackground}
      p={{base: 'xs', sm: 'md', md: 'xl'}}
      style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}
    >
      <Paper
        bg="rgba(255, 255, 255, 0.85)"
        w={{base: '100%', md: 1200}}
        maw="100%"
        mih={{base: 0, md: 560}}
        p={{base: 'md', md: 'xl'}}
        radius="xl"
        shadow="xl"
        style={{display: 'flex', flexDirection: 'column', justifyContent: 'center'}}
      >
        <Stack gap="lg" align="center">
          <Stack gap="10px">
            <Title order={1} ta="center" fw={1300}>
              Sentence Builder
            </Title>
            <Text ta="center" c="dimmed" fs="italic">
              Put the words in order · {round + 1}/{SENTENCES.length}
            </Text>
          </Stack>

          {score > 0 && <ScoreBeads score={score} />}

          {/* Answer area */}
          <Paper
            withBorder
            w="100%"
            mih={100}
            p="md"
            radius="md"
            bg="white"
            style={{borderStyle: 'dashed', borderWidth: 2}}
          >
            <Group mih={68} gap="sm" justify="center" data-cy="sentence-answer">
              {built.length === 0 && (
                <Text c="dimmed" fs="italic">
                  Tap the words below
                </Text>
              )}
              {built.map(t => (
                <Button
                  key={t.key}
                  size="xl"
                  radius="xl"
                  variant="filled"
                  disabled={result === 'correct'}
                  onClick={() => setBuilt(built.filter(b => b.key !== t.key))}
                >
                  {t.text}
                </Button>
              ))}
            </Group>
          </Paper>

          {/* Word bank */}
          <Group mih={68} gap="sm" justify="center" data-cy="sentence-bank">
            {remaining.map(t => (
              <Button key={t.key} size="xl" radius="xl" variant="light" onClick={() => setBuilt([...built, t])}>
                {t.text}
              </Button>
            ))}
          </Group>

          <Text c={result === 'correct' ? 'green' : 'red'} fw={700} size="lg" mih={28}>
            {result === 'correct' && 'Correct!'}
            {result === 'wrong' && 'Not quite, try again'}
          </Text>

          <Group>
            <Button size="lg" variant="default" onClick={reset}>
              Reset
            </Button>
            {result === 'correct' ? (
              <Button size="lg" onClick={next}>
                Next
              </Button>
            ) : (
              <Button size="lg" disabled={remaining.length > 0} onClick={check}>
                Check
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </BackgroundImage>
  )
}
