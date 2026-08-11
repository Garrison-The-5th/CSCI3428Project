/**
 * File: prisma-client.ts
 * Description: Prisma client for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

// Reuse PrismaClient in dev to avoid exhausting connections on hot reload
const prismaGlobal = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  prismaGlobal.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  prismaGlobal.prisma = prisma;
}

// Move connect/disconnect here
export async function connectDB() {
  console.log('Connecting to the database with Prisma...');
  await prisma.$connect();
}

export async function disconnectDB() {
  await prisma.$disconnect();
  console.log('Prisma disconnected from database');
}
