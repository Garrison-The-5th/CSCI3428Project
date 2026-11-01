/**
 * Sentence Builder Game (skeleton)
 *
 * The player taps shuffled word tiles to build a very basic sentence in the
 * right order. Tiles are English translations of words from the other games.
 *
 * TODO: Mik'maq display/audio on tiles, scoring beads, win popup, level select.
 */

import { Box, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useMemo, useState } from "react";

import { SENTENCES } from "./sentence-data";

type Tile = { key: number; text: string };

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

export function SentenceBuilderGame() {
  const [round, setRound] = useState(0);
  const [built, setBuilt] = useState<Tile[]>([]);
  const [result, setResult] = useState<"correct" | "wrong" | null>(null);

  const sentence = SENTENCES[round];

  // Shuffled bank for the current round; `key` keeps duplicate words distinct
  const bank = useMemo(
    () => shuffle(sentence.tiles.map((text, key) => ({ key, text }))),
    [sentence],
  );
  const remaining = bank.filter((t) => !built.some((b) => b.key === t.key));

  const check = () => {
    const correct = built.every((t, i) => t.text === sentence.tiles[i]);
    setResult(correct ? "correct" : "wrong");
  };

  const reset = () => {
    setBuilt([]);
    setResult(null);
  };

  const next = () => {
    setRound((round + 1) % SENTENCES.length);
    reset();
  };

  return (
    <Box
      h="var(--app-height)"
      p="md"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Paper
        w={{ base: "100%", md: 800 }}
        p="xl"
        radius="xl"
        shadow="xl"
        withBorder
      >
        <Stack gap="lg" align="center">
          <Title order={1}>Sentence Builder</Title>
          <Text c="dimmed">Put the words in order</Text>

          {/* Answer area */}
          <Group mih={60} gap="xs" justify="center" data-cy="sentence-answer">
            {built.map((t) => (
              <Button
                key={t.key}
                variant="filled"
                disabled={result === "correct"}
                onClick={() => setBuilt(built.filter((b) => b.key !== t.key))}
              >
                {t.text}
              </Button>
            ))}
          </Group>

          {/* Word bank */}
          <Group gap="xs" justify="center" data-cy="sentence-bank">
            {remaining.map((t) => (
              <Button
                key={t.key}
                variant="light"
                onClick={() => setBuilt([...built, t])}
              >
                {t.text}
              </Button>
            ))}
          </Group>

          {result === "correct" && (
            <Text c="green" fw={700}>
              Correct!
            </Text>
          )}
          {result === "wrong" && (
            <Text c="red" fw={700}>
              Not quite, try again
            </Text>
          )}

          <Group>
            <Button variant="default" onClick={reset}>
              Reset
            </Button>
            {result === "correct" ? (
              <Button onClick={next}>Next</Button>
            ) : (
              <Button disabled={remaining.length > 0} onClick={check}>
                Check
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </Box>
  );
}
