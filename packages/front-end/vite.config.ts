import react from '@vitejs/plugin-react-swc'
import {defineConfig} from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
      '/public': 'http://localhost:5050'

    }
  }
})