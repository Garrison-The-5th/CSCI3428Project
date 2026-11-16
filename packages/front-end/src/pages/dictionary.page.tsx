/**
 * Purpose: Dictionary page listing every word with search, image and audio.
 *
 * Author: Jacob Matthews
 */
import {Badge, Container, Group, Stack, Title} from '@mantine/core'
import {useLoaderData} from 'react-router'

import {DictionaryBrowser} from '@/components/Dictionary'
import {wordsLoader} from '@/router/words.loader'

export function DictionaryPage() {
  const {words} = useLoaderData<typeof wordsLoader>()

  return (
    <Container size="xl" py="md">
      <Stack>
        <Group gap="sm">
          <Title order={1} c="blue.6">
            Kllusuwaqnn Kwilmumkl - Dictionary
          </Title>
          <Badge variant="light">{words.length} words</Badge>
        </Group>
        <DictionaryBrowser />
      </Stack>
    </Container>
  )
}
