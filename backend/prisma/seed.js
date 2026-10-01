import { PrismaClient } from '../src/generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import logger from '../src/utils/logger.js';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL || 'admin@novrcampaign.local';
  const password = process.env.SEED_PASSWORD || 'admin12345';

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name: 'Admin', role: 'ADMIN' },
  });

  logger.info(`Seeded user: ${user.email} (password: ${password})`);
  logger.info('Set PLUNK_API_KEY in backend/.env to enable sending.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
