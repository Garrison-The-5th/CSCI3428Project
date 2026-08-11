/**
 * File: prisma.config.ts
 * Description: Prisma.config for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { config } from 'dotenv';
import { join } from 'path';
import { defineConfig, env } from 'prisma/config';

config({ path: join(__dirname, '../.env') });

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
    seed: 'tsx seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
