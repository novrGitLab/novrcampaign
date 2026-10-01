import app from './app.js';
import { config } from './config/env.js';
import logger from './utils/logger.js';
import prisma from './utils/prisma.js';

async function bootstrap() {
  await prisma.$connect().catch((err) => {
    logger.warn({ err: err.message }, 'Database not reachable at startup — continuing');
  });

  const server = app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down gracefully');
    server.close();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Crash on unhandled rejections rather than limping along
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
