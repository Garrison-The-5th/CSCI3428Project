/**
 * File: seed.ts
 * Description: Seed for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { prisma } from './prisma-client';

const users = [
  {
    email: 'Him@example.com',
    name: 'LeBron James',
  },
  {
    email: 'mrbeast@example.com',
    name: 'MrBeast',
  },
  {
    email: 'bob@example.com',
    name: 'SpongeBob',
  },
  {
    email: 'patrick@example.com',
    name: 'Patrick',
  },
  {
    email: 'ronald@example.com',
    name: 'Ronald',
  },
  {
    email: 'test6@example.com',
    name: 'Test6',
  },
  {
    email: 'test7@example.com',
    name: 'Test7',
  },
  {
    email: 'test8@example.com',
    name: 'Test8',
  },
];

/** Inserts the sample users above into an empty database. */
async function main() {
  console.log('Seeding users...');
  for (const user of users) {
    await prisma.user.create({ data: user });
  }

  console.log(`Seeded ${users.length} users successfully.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
