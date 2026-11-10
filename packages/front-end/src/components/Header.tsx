/**
 * Purpose: Navigation header component with Mi'kmaq/English menu items and dictionary access
 *
 * Author: Jack Greenlaw
 * Edits: Alison Cook
 */
import {
  Burger,
  Collapse,
  Container,
  Group,
  Stack,
  Text
} from '@mantine/core'
import {useDisclosure} from '@mantine/hooks'
import {Link, useLocation} from 'react-router'

import classes from '@/styles/HeaderStyle.module.css'
import {ColorSchemeToggle} from './ColorSchemeToggle'
import {Dictionary} from './Dictionary'

const links = [
  {link: '/', mikmaq: "Apaja'si Nikantuk", english: 'Home'},
  {link: '/matching-game', mikmaq: 'Klusuwaqnminal', english: 'Word Match'},
  {
    link: '/eskasoni-island-game',
    mikmaq: "Te'puljwe'kati Waisisk",
    english: 'Goat Island Animals'
  },
  // No Mi'kmaq title yet for this game, so only the English name is shown
  {link: '/sentence-builder-game', mikmaq: '', english: 'Sentence Builder'},
  {link: '/admin', mikmaq: "Nikana'tu'tite'wk", english: 'Admin'}
]

/**
 * Purpose: Renders the application header with navigation links, mobile burger menu, and dictionary button.
 * Displays bilingual navigation items (Mi'kmaq above English text) and highlights the active page.
 *
 * Parameters: None
 */
export function Header() {
  const location = useLocation()
  const [opened, {toggle, close}] = useDisclosure(false)

  const renderLinks = (onClick?: () => void) =>
    links.map(link => (
    <Link
      key={link.link}
      to={link.link}
      onClick={onClick}
      className={classes.link}
      data-active={location.pathname === link.link || undefined}
    >
      <Stack gap={0} align="center">
        {link.mikmaq ? (
          <>
            <Text span>{link.mikmaq}</Text>
            <Text span size="12px" style={{opacity: 0.8}}>
              {link.english}
            </Text>
          </>
        ) : (
          <Text span>{link.english}</Text>
        )}
      </Stack>
    </Link>
    ))
  return (
    <header className={classes.header}>
      <Container size="lg" className={classes.inner}>
        <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" aria-label="Toggle navigation" />
        <Group gap={4} wrap="nowrap" visibleFrom="md">
          {renderLinks()}
        </Group>
        <Group gap="xs" wrap="nowrap" style={{flexShrink: 0}}>
          <ColorSchemeToggle />
          <Dictionary />
        </Group>
      </Container>
      <Collapse in={opened} hiddenFrom="md" className={classes.menu}>
        <Stack gap={4} p="sm">
          {renderLinks(close)}
        </Stack>
      </Collapse>
    </header>
  )
}
