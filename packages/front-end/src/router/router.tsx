/**
 * The routes to other pages
 *
 * Author(s):
 * Wenda Tan
 * (Originally John's Code)
 */

import {AppShell, Burger, Group, Text} from '@mantine/core'
import {useDisclosure} from '@mantine/hooks'
import {FeatherIcon} from '@phosphor-icons/react'
import {createBrowserRouter, Outlet, RouterProvider} from 'react-router'

import {Sidebar} from '@/components/Sidebar'
import {
  AdminGameSettingsPage,
  AdminPage,
  DictionaryPage,
  ErrorPage,
  FAQ,
  HomePage,
  IslandGamePage,
  NikanatutitewkPage,
  PrivacyPolicy,
  SigninPage,
  WordMatchGame
} from '@/pages'
import {adminLoader} from './admin.loader'
import {authLoader} from './auth.loader'
import {signinLoader} from './signin.loader'
import {wordsLoader} from './words.loader'

const router = createBrowserRouter([
  {
    element: <Layout />,
    loader: wordsLoader,
    children: [
      {
        path: '/',
        element: <HomePage />
      },
      {
        path: '/matching-game',
        loader: wordsLoader,
        element: <WordMatchGame />
      },
      {
        path: '/eskasoni-island-game',
        element: <IslandGamePage />
      },
      {
        path: '/dictionary',
        loader: wordsLoader,
        element: <DictionaryPage />
      },
      {
        path: '/faq',
        element: <FAQ />
      },
      {
        path: '/privacypolicy',
        element: <PrivacyPolicy />
      },
      {
        path: '/nikanatutitewk',
        element: <NikanatutitewkPage />
      },
      {
        path: '/admin',
        loader: adminLoader,
        element: <AdminPage />
      },
      {
        path: '/admin/signin',
        loader: signinLoader,
        element: <SigninPage />
      },
      {
        path: '/admin/game-settings',
        loader: authLoader,
        element: <AdminGameSettingsPage />
      }
    ]
  },
  {
    path: '*',
    element: <ErrorPage />
  }
])

export function Router() {
  return <RouterProvider router={router} />
}

function Layout() {
  const [opened, {toggle, close}] = useDisclosure(false)

  return (
    <AppShell
      header={{height: {base: 56, sm: 0}}}
      navbar={{width: 280, breakpoint: 'sm', collapsed: {mobile: !opened}}}
      padding="md"
    >
      <AppShell.Header hiddenFrom="sm">
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="Toggle navigation" />
          <FeatherIcon size={28} weight="duotone" color="var(--mantine-color-yellow-6)" />
          <Text fw="bold" fs="italic">
            Mikwite'tmk+t Angie
          </Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <Sidebar onNavigate={close} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
