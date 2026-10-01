import { PrismaClient } from '../generated/prisma/client.js';
import logger from './logger.js';

// Single shared Prisma instance across the process (avoids connection exhaustion
// under hot-reload in dev).
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

prisma.$on('warn', (e) => logger.warn({ prisma: e.message }, 'Prisma warning'));
prisma.$on('error', (e) => logger.error({ prisma: e.message }, 'Prisma error'));

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;

export default prisma;
