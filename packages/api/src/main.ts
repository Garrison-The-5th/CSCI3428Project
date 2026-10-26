/**
 * Main entry point for the API server.
 *
 * @author Sean MacDougall
 */

import 'dotenv/config' // load env variables from a .env file

import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import cors from 'cors'
import express from 'express'
import morgan from 'morgan'
import z from 'zod'

import {auth} from './controllers/auth'
import {users} from './controllers/users'
import {words} from './controllers/words'

const envSchema = z.looseObject({
  PORT: z.string().optional(),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(10),
  ORIGIN: z.url().optional()
})

function bootstrap() {
  // validate environment variables
  const {error} = envSchema.safeParse(process.env)
  if (error) {
    console.error('Invalid environment variables')
    console.error(z.prettifyError(error))
    process.exit(1)
  }

  const app = express()

  // global middlewares
  app.use(express.json())
  app.use(express.urlencoded({extended: true}))
  app.use(morgan('tiny'))

  if (process.env.ORIGIN) {
    app.use(cors({origin: process.env.ORIGIN}))
  }

  // handlers from other files
  app.use('/api/words', words)
  app.use('/api/auth', auth)
  app.use('/api/users', users)

  // public assets
  app.use('/public', express.static('public'))

  // client bundle (the production build of the front-end, created by `npm run build`)
  const clientDir = fileURLToPath(new URL('../../front-end/dist', import.meta.url))
  const clientIndex = path.join(clientDir, 'index.html')
  if (fs.existsSync(clientIndex)) {
    app.use(express.static(clientDir))
    app.get('/*splat', async (_req, res) => {
      return res.sendFile(clientIndex)
    })
  } else {
    console.log('ℹ️  No front-end build found, serving the API only (run `npm run build` to build the front-end)')
  }

  // start server
  const port = process.env.PORT || 5050
  app.listen(port, () => console.log(`✅ Server running on port ${port}`))
}

bootstrap()
