/**
 * Purpose: Sidebar navigation for the app. Groups games and user information
 * into collapsible sections and highlights the active page.
 *
 * Author: Jacob Matthews
 */
import type {Icon} from '@phosphor-icons/react'

import {Group, NavLink, ScrollArea, Text} from '@mantine/core'
import {
  BooksIcon,
  FeatherIcon,
  GameControllerIcon,
  GearSixIcon,
  HouseIcon,
  InfoIcon,
  PawPrintIcon,
  PencilSimpleIcon,
  PuzzlePieceIcon,
  QuestionIcon,
  ShieldCheckIcon,
  SignInIcon,
  UsersThreeIcon
} from '@phosphor-icons/react'
import {Link, useLocation} from 'react-router'

import classes from '@/styles/SidebarStyle.module.css'

type SidebarLink = {
  label: string
  description?: string
  icon: Icon
  link?: string
  children?: SidebarLink[]
}

const links: SidebarLink[] = [
  {label: 'Home Page', description: "Apaja'si Nikantuk", icon: HouseIcon, link: '/'},
  {
    label: 'Games',
    icon: GameControllerIcon,
    children: [
      {label: 'Word Match', description: 'Klusuwaqnminal', icon: PuzzlePieceIcon, link: '/matching-game'},
      {
        label: 'Goat Island Animals',
        description: "Te'puljwe'kati Waisisk",
        icon: PawPrintIcon,
        link: '/eskasoni-island-game'
      }
    ]
  },
  {label: 'Admin Login', icon: SignInIcon, link: '/admin/signin'},
  {label: 'Admin Game Settings', icon: GearSixIcon, link: '/admin/game-settings'},
  {label: 'Dictionary', description: 'Kllusuwaqnn Kwilmumkl', icon: BooksIcon, link: '/dictionary'},
  {label: 'Edit Dictionary', icon: PencilSimpleIcon, link: '/admin'},
  {
    label: 'User Information',
    icon: InfoIcon,
    children: [
      {label: 'FAQ', icon: QuestionIcon, link: '/faq'},
      {label: 'Privacy Policy', icon: ShieldCheckIcon, link: '/privacypolicy'},
      {label: "Nikana'tu'tite'wk", icon: UsersThreeIcon, link: '/nikanatutitewk'}
    ]
  }
]

/**
 * Purpose: Renders the sidebar contents (brand + navigation links).
 *
 * Parameters:
 * onNavigate - called when a link is clicked, used to close the sidebar on mobile
 */
export function Sidebar({onNavigate}: {onNavigate?: () => void}) {
  const {pathname} = useLocation()

  const renderLink = (item: SidebarLink) => {
    const Icon = item.icon
    const icon = <Icon size={20} weight="duotone" />

    if (item.children) {
      const childActive = item.children.some(child => child.link === pathname)
      return (
        <NavLink
          key={item.label}
          label={item.label}
          leftSection={icon}
          defaultOpened={childActive}
          active={childActive}
          variant="subtle"
          className={classes.link}
        >
          {item.children.map(renderLink)}
        </NavLink>
      )
    }

    return (
      <NavLink
        key={item.label}
        component={Link}
        to={item.link!}
        label={item.label}
        description={item.description}
        leftSection={icon}
        active={pathname === item.link}
        onClick={onNavigate}
        className={classes.link}
      />
    )
  }

  return (
    <>
      <Group gap="sm" className={classes.brand} visibleFrom="sm">
        <FeatherIcon size={32} weight="duotone" color="var(--mantine-color-yellow-6)" />
        <Text fw="bold" size="lg" fs="italic">
          Mikwite'tmk+t Angie
        </Text>
      </Group>
      <ScrollArea className={classes.links}>{links.map(renderLink)}</ScrollArea>
    </>
  )
}
