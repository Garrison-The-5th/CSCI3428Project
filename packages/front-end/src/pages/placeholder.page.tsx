/**
 * Purpose: Blank pages for sidebar sections that haven't been built yet.
 *
 * Author: Jacob Matthews
 */
import {Container, Text, Title} from '@mantine/core'

function PlaceholderPage({title}: {title: string}) {
  return (
    <Container size="md" py="xl">
      <Title order={1} c="blue.6">
        {title}
      </Title>
      <Text c="dimmed" mt="md">
        Coming soon.
      </Text>
    </Container>
  )
}

export function AdminGameSettingsPage() {
  return <PlaceholderPage title="Admin Game Settings" />
}

export function NikanatutitewkPage() {
  return <PlaceholderPage title="Nikana'tu'tite'wk" />
}
