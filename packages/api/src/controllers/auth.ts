/**
 * Controller for authentication routes.
 *
 * @author Sean MacDougall
 */

import {compare} from 'bcryptjs'
import {Router} from 'express'
import jwt from 'jsonwebtoken'

import {prisma} from '@/prisma'

export const auth = Router()

const MAX_ATTEMPTS = 3

function hasTenMinutesPassed(pastDate: Date): boolean {
  const TEN_MINUTES_MS = 10 * 60 * 1000
  return Date.now() - pastDate.getTime() >= TEN_MINUTES_MS
}

auth.post('/', async (req, res) => {
  const {username, password} = req.body

  const user = await prisma.user.findUnique({
    where: {username},
    select: {id: true, password: true, loginFailCount: true, loginLastFail: true}
  })

  if (!user) {
    return res.status(401).json({error: 'Invalid username or password'})
  }

  // treat the count as 0 if the last failure was more than 10 minutes ago
  let failCount = user.loginFailCount
  if (failCount !== 0 && user.loginLastFail && hasTenMinutesPassed(user.loginLastFail)) {
    failCount = 0
  }

  // too many recent failures: block the attempt
  if (failCount >= MAX_ATTEMPTS) {
    return res.status(429).json({error: 'Too many failed attempts, try again in 10 minutes'})
  }

  // wrong password: record the failure and its time
  if (!(await compare(password, user.password))) {
    await prisma.user.update({
      where: {id: user.id},
      data: {loginFailCount: failCount + 1, loginLastFail: new Date()}
    })
    return res.status(401).json({error: 'Invalid username or password'})
  }

  // success: clear the counter if it was set
  if (user.loginFailCount !== 0) {
    await prisma.user.update({
      where: {id: user.id},
      data: {loginFailCount: 0, loginLastFail: null}
    })
  }

  const token = jwt.sign({sub: user.id}, process.env.JWT_SECRET, {expiresIn: '7d'})
  return res.json({token})
})