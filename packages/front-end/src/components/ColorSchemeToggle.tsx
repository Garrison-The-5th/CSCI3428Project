/**
 * Purpose: Button that switches between light and dark mode
 *
 * Parameters: None
 */
import {ActionIcon, useComputedColorScheme, useMantineColorScheme} from '@mantine/core'
import {MoonIcon, SunIcon} from '@phosphor-icons/react'

export function ColorSchemeToggle() {
  const {setColorScheme} = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true
  })
  const isDark = computedColorScheme === 'dark'

  return (
    <ActionIcon
      variant="default"
      size={48}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </ActionIcon>
  )
}
