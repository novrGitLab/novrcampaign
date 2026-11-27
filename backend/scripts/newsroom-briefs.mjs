import Joi from 'joi';
import { prisma } from '../src/utils/prisma.js';
import { fillNewsroomBriefs } from '../src/services/newsroomBriefs.js';
import { isConfigured } from '../src/services/novrpulse/understand/orchestrator.js';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const index = args.indexOf('--limit');
const idIndex = args.indexOf('--id');
const eventId = idIndex === -1 ? undefined : args[idIndex + 1];
const limit = index === -1 ? 10 : Number(args[index + 1]);
try {
  if (idIndex !== -1 && Joi.string().uuid().required().validate(eventId).error)
    throw Error('Choose a valid story ID.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Choose a limit between 1 and 100.');
  if (commit && !isConfigured()) throw Error('The newsroom model is unavailable.');
  const result = await fillNewsroomBriefs({ limit, commit, eventId });
  console.log(JSON.stringify({ commit, ...result }));
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
