/**
 * Seed script to populate the database with initial data.
 *
 * @author Sean MacDougall
 */

import 'dotenv/config' // load env variables from a .env file

import {createDefaultUser} from './create-default-user'
import {importWords} from './words/import-words'

async function main() {
  await createDefaultUser()
  await importWords()
}

main()
