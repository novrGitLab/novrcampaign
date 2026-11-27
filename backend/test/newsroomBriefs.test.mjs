import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/prisma.js';
import { fillNewsroomBriefs, suitableBrief } from '../src/services/newsroomBriefs.js';

test('public briefs need usable original copy and context', () => {
  const source =
    'The regulator published its final reporting requirements for electronic payments on Monday.';
  const brief = {
    summary: 'Payment firms received final guidance from the regulator this week.',
    whatItMeans: 'The guidance gives reporting teams a reference for their next filing.',
  };
  assert.equal(suitableBrief(source, brief), true);
  for (const summary of [
    source,
    'As an AI, the latest article can be summarised.',
    '<b>Reporting requirements</b> changed this week.',
    '',
    null,
  ]) {
    assert.equal(suitableBrief(source, { ...brief, summary }), false);
  }
});

test('stored eligible stories are claimed once and editorial edits win', async (t) => {
  const id = randomUUID();
  const url = 'https://example.test/brief/' + id;
  const body =
    'The newsroom test source describes a new process for users to download their contact records. A service notice outlines when the change begins and which records are available for export.';
  await prisma.npSource.create({
    data: { id, name: 'Example', url, region: 'NG', type: 'news', functions: [] },
  });
  const raw = await prisma.npRawDocument.create({ data: { sourceId: id, contentHash: id, url, body } });
  const event = await prisma.npEvent.create({
    data: {
      title: 'Contact record exports',
      canonicalUrl: url,
      functions: [],
      isCybersecurity: true,
      publishedAt: new Date(),
      sources: { create: { rawDocumentId: raw.id } },
    },
  });
  t.after(async () => {
    await prisma.npEvent.delete({ where: { id: event.id } });
    await prisma.npRawDocument.delete({ where: { id: raw.id } });
    await prisma.npSource.delete({ where: { id } });
    await prisma.$disconnect();
  });
  let calls = 0;
  const options = {
    limit: 1,
    eventId: event.id,
    summarise: async () => {
      calls++;
      return {
        summary: 'The service has introduced contact exports for its users.',
        whatItMeans: 'Account holders can obtain a copy of their records.',
      };
    },
  };
  assert.equal((await fillNewsroomBriefs(options)).candidates, 1);
  assert.equal(calls, 0);
  const runs = await Promise.all([
    fillNewsroomBriefs({ ...options, commit: true }),
    fillNewsroomBriefs({ ...options, commit: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(
    runs.reduce((n, r) => n + r.saved, 0),
    1,
  );
  await prisma.npEvent.update({
    where: { id: event.id },
    data: { summary: '', whatItMeans: '', publicBriefAttemptedAt: null },
  });
  const race = await fillNewsroomBriefs({
    ...options,
    commit: true,
    summarise: async () => {
      await prisma.npEvent.update({ where: { id: event.id }, data: { summary: 'Edited by the newsroom.' } });
      return options.summarise();
    },
  });
  assert.equal(race.saved, 0);
  assert.equal(
    (await prisma.npEvent.findUniqueOrThrow({ where: { id: event.id } })).summary,
    'Edited by the newsroom.',
  );
});
