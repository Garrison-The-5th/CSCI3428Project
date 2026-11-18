/**
 * Purpose: Flashcards, opened from the dictionary. Browse mode steps through every word; Review mode uses spaced
 * repetition so words you miss come back sooner and words you know come back less often. Click the card to flip
 * between the Mi'kmaq word (front) and the English meaning + picture (back).
 */
import type {Word} from '@/types'

import {
  ActionIcon,
  Button,
  Container,
  Group,
  Image,
  MultiSelect,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  TagsInput,
  Text,
  Title
} from '@mantine/core'
import {ArrowLeftIcon, ArrowRightIcon, CheckIcon, ShuffleIcon, XIcon} from '@phosphor-icons/react'
import {useState} from 'react'

import AudioButton from '@/components/AudioButton'
import {toStorageUrl} from '@/utils'
import {dueWords, grade, loadProgress, nextDue, saveProgress} from '@/utils/srs'
import {allTags, filterByTags, loadTags, saveTags, setWordTags, type Tags} from '@/utils/tags'

const shuffle = <T,>(items: T[]) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function Card({word, flipped, onFlip}: {word: Word; flipped: boolean; onFlip: () => void}) {
  return (
    <Paper
      withBorder
      shadow="sm"
      p="xl"
      w="100%"
      mih={380}
      onClick={onFlip}
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
          <Image src={toStorageUrl(word.imagePath)} alt={word.mikmaq} h={220} fit="contain" />
          <Text fz={32} fw={700}>
            {word.english}
          </Text>
        </Stack>
      ) : (
        <Stack align="center" gap="sm">
          <Text fz={46} fw={700}>
            {word.mikmaq}
          </Text>
          <div onClick={e => e.stopPropagation()}>
            <AudioButton src={toStorageUrl(word.audioPath)} variant="light" size="lg" aria-label="Play audio" />
          </div>
        </Stack>
      )}
    </Paper>
  )
}

function TagEditor({
  word,
  tags,
  suggestions,
  onChange
}: {
  word: Word
  tags: Tags
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  return (
    <TagsInput
      w="100%"
      size="sm"
      placeholder="Add a tag and press Enter"
      aria-label="Tags"
      data={suggestions}
      value={tags[word.id] ?? []}
      onChange={onChange}
    />
  )
}

function Browse({words, tags, onTag}: {words: Word[]; tags: Tags; onTag: (id: string, tags: string[]) => void}) {
  const [deck, setDeck] = useState(words)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

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
    <Stack align="center" gap="md">
      <Text c="dimmed" size="sm">
        Click the card to flip it
      </Text>

      <Card word={deck[index]} flipped={flipped} onFlip={() => setFlipped(f => !f)} />

      <TagEditor word={deck[index]} tags={tags} suggestions={allTags(tags)} onChange={t => onTag(deck[index].id, t)} />

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
  )
}

function Review({words, tags, onTag}: {words: Word[]; tags: Tags; onTag: (id: string, tags: string[]) => void}) {
  const [progress, setProgress] = useState(loadProgress)
  const [queue, setQueue] = useState(() => dueWords(words, progress))
  const [total] = useState(queue.length)
  const [flipped, setFlipped] = useState(false)

  const answer = (correct: boolean) => {
    const [word, ...rest] = queue
    const next = grade(progress, word.id, correct)
    setProgress(next)
    saveProgress(next)
    // a missed card goes to the back of this session's queue so it's seen again before you finish
    setQueue(correct ? rest : [...rest, word])
    setFlipped(false)
  }

  if (!queue.length) {
    const next = nextDue(progress)
    return (
      <Stack align="center" gap="xs" py="xl">
        <Text fz={24} fw={700}>
          You're all caught up!
        </Text>
        <Text c="dimmed" ta="center">
          {next ? `Your next review is ready ${new Date(next).toLocaleString()}.` : 'There are no words to review yet.'}
        </Text>
      </Stack>
    )
  }

  return (
    <Stack align="center" gap="md">
      <Text c="dimmed" size="sm">
        Flip the card, then tell us if you knew it
      </Text>

      <Card word={queue[0]} flipped={flipped} onFlip={() => setFlipped(f => !f)} />

      <TagEditor word={queue[0]} tags={tags} suggestions={allTags(tags)} onChange={t => onTag(queue[0].id, t)} />

      <Progress value={((total - queue.length) / total) * 100} w="100%" size="sm" />
      <Text size="sm">{queue.length} left</Text>

      <Group>
        <Button
          color="red"
          variant="light"
          leftSection={<XIcon size={16} />}
          disabled={!flipped}
          onClick={() => answer(false)}
        >
          Didn't know
        </Button>
        <Button
          color="green"
          variant="light"
          leftSection={<CheckIcon size={16} />}
          disabled={!flipped}
          onClick={() => answer(true)}
        >
          Knew it
        </Button>
      </Group>
    </Stack>
  )
}

export function Flashcards({words}: {words: Word[]}) {
  const [mode, setMode] = useState('browse')
  const [tags, setTags] = useState(loadTags)
  const [selected, setSelected] = useState<string[]>([])

  const onTag = (id: string, wordTags: string[]) => {
    const next = setWordTags(tags, id, wordTags)
    setTags(next)
    saveTags(next)
    // drop filters for tags that no longer exist
    setSelected(sel => sel.filter(tag => allTags(next).includes(tag)))
  }

  const filtered = filterByTags(words, tags, selected)

  if (!words.length) {
    return (
      <Container py="xl">
        <Text ta="center">No words yet.</Text>
      </Container>
    )
  }

  return (
    <Container size="xl" py="xl">
      <Stack align="center" gap="md">
        <Title order={2}>Flashcards</Title>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          data={[
            {label: 'Browse', value: 'browse'},
            {label: 'Review', value: 'review'}
          ]}
        />
        {allTags(tags).length > 0 && (
          <MultiSelect
            w="100%"
            size="sm"
            placeholder="Filter by tag"
            aria-label="Filter by tag"
            data={allTags(tags)}
            value={selected}
            onChange={setSelected}
            clearable
          />
        )}
        {!filtered.length ? (
          <Text c="dimmed">No cards have those tags.</Text>
        ) : mode === 'browse' ? (
          <Browse key={`browse-${selected.join()}`} words={filtered} tags={tags} onTag={onTag} />
        ) : (
          <Review key={`review-${selected.join()}`} words={filtered} tags={tags} onTag={onTag} />
        )}
      </Stack>
    </Container>
  )
}
