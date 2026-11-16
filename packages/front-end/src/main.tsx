import '@mantine/core/styles.css'

import type {MantineThemeOverride} from '@mantine/core'

import {MantineProvider} from '@mantine/core'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import '@mantine/core/styles.css'
import './index.css'

import {Router} from './router/router.tsx'

const theme: MantineThemeOverride = {
  defaultRadius: 'md',
  colors: {
    // Wooden brown used for the score beads; shade 6 is the primary tone
    bead: ['#fbf3ea', '#f1e0cc', '#e4c3a0', '#d7a671', '#c98b4a', '#be7628', '#b5651d', '#9a5517', '#7f4612', '#64370e']
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Router />
    </MantineProvider>
  </StrictMode>
)
