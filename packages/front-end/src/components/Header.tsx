/**
 * Purpose: Navigation header component with Mi'kmaq/English menu items and dictionary access
 *
 * Author: Jack Greenlaw
 * Edits: Alison Cook
 */
import {
  ActionIcon,
  Burger,
  Container,
  Group,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import {useDisclosure} from '@mantine/hooks'
import {MoonIcon, SunIcon} from '@phosphor-icons/react'
import {Link, useLocation} from 'react-router'

import classes from '@/styles/HeaderStyle.module.css'
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
  const [opened, {toggle}] = useDisclosure(false)
  const {setColorScheme} = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true
  })
  const isDark = computedColorScheme === 'dark'

  const items = links.map(link => (
    <Link
      key={link.link}
      to={link.link}
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
        <Group gap={8} visibleFrom="xs">
          {items}
        </Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="xs" size="sm" />
        <Group gap="xs">
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
          </ActionIcon>
          <Dictionary />
        </Group>
      </Container>
    </header>
  )
}
