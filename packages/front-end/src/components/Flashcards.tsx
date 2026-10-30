/**
 * Purpose: Basic flashcards, opened from the dictionary. Shows one dictionary word at a time; click the card to flip
 * between the Mi'kmaq word (front) and the English meaning + picture (back).
 */
import type {Word} from '@/types'

import {ActionIcon, Button, Container, Group, Image, Paper, Progress, Stack, Text, Title} from '@mantine/core'
import {ArrowLeftIcon, ArrowRightIcon, ShuffleIcon} from '@phosphor-icons/react'
import {useState} from 'react'

import AudioButton from '@/components/AudioButton'
import {toStorageUrl} from '@/utils'

const shuffle = <T,>(items: T[]) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function Flashcards({words}: {words: Word[]}) {
  const [deck, setDeck] = useState(words)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  if (!deck.length) {
    return (
      <Container py="xl">
        <Text ta="center">No words yet.</Text>
      </Container>
    )
  }

  const word = deck[index]

  const goTo = (next: number) => {
    setFlipped(false)
    setIndex((next + deck.length) % deck.length)
  }

  const onShuffle = () => {
    setDeck(shuffle(words))
    setFlipped(false)
    setIndex(0)
  }

  return (
    <Container size="sm" py="xl">
      <Stack align="center" gap="md">
        <Title order={2}>Flashcards</Title>
        <Text c="dimmed" size="sm">
          Click the card to flip it
        </Text>

        <Paper
          withBorder
          shadow="sm"
          p="xl"
          w="100%"
          mih={320}
          onClick={() => setFlipped(f => !f)}
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          role="button"
          aria-label="Flip card"
        >
          {flipped ? (
            <Stack align="center" gap="sm">
              <Image src={toStorageUrl(word.imagePath)} alt={word.mikmaq} h={180} fit="contain" />
              <Text fz={28} fw={700}>
                {word.english}
              </Text>
            </Stack>
          ) : (
            <Stack align="center" gap="sm">
              <Text fz={40} fw={700}>
                {word.mikmaq}
              </Text>
              <div onClick={e => e.stopPropagation()}>
                <AudioButton src={toStorageUrl(word.audioPath)} variant="light" size="lg" aria-label="Play audio" />
              </div>
            </Stack>
          )}
        </Paper>

        <Progress value={((index + 1) / deck.length) * 100} w="100%" size="sm" />
        <Text size="sm">
          {index + 1} / {deck.length}
        </Text>

        <Group>
          <Button variant="default" leftSection={<ArrowLeftIcon size={16} />} onClick={() => goTo(index - 1)}>
            Previous
          </Button>
          <ActionIcon variant="default" size="lg" onClick={onShuffle} aria-label="Shuffle">
            <ShuffleIcon size={18} />
          </ActionIcon>
          <Button variant="default" rightSection={<ArrowRightIcon size={16} />} onClick={() => goTo(index + 1)}>
            Next
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
