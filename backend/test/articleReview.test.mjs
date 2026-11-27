import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/prisma.js';
import { findNews, listNews } from '../src/services/publicNews.js';
import { rejectedStories, restoreStory } from '../src/services/rejectedStories.js';
import { generateArticle, saveArticle } from '../src/services/articleReview.js';

test('a new article is private until approval and later changes cannot overwrite a newer draft', async (t) => {
  const id = randomUUID(),
    url = 'https://example.org/' + id;
  await prisma.npSource.create({
    data: { id, name: 'Fixture', url, region: 'AF', type: 'rss', functions: [] },
  });
  const raw = await prisma.npRawDocument.create({ data: { sourceId: id, contentHash: id, url } });
  await prisma.npEvent.create({
    data: {
      id,
      title: 'Records audit at two libraries',
      functions: [],
      publishedAt: new Date(),
      isCybersecurity: true,
      cyberRegion: 'AF',
      canonicalUrl: url,
      sources: { create: { rawDocumentId: raw.id } },
    },
  });
  t.after(async () => {
    await prisma.npEvent.delete({ where: { id } });
    await prisma.npRawDocument.delete({ where: { id: raw.id } });
    await prisma.npSource.delete({ where: { id } });
    await prisma.$disconnect();
  });
  const source = {
    source: 'Fixture',
    url,
    text: 'The libraries published an update to the use of staff accounts.',
  };
  const article = {
    headline: 'Libraries complete staff access review',
    standfirst: 'Two libraries have finished examining staff permissions across their archives.',
    sections: [
      {
        heading: 'Scope of the review',
        paragraphs: ['The two institutions reviewed which staff could consult the archive.'],
      },
      {
        heading: 'Changes for readers',
        paragraphs: ['Readers retain the existing catalogue access arrangements.'],
      },
    ],
  };
  assert.equal(await findNews(id), null);
  await generateArticle(id, 0, {
    evidence: async () => source,
    llm: () => ({ complete: async () => ({ ...article, sufficient: true }) }),
  });
  assert.equal(await findNews(id), null);
  await saveArticle(id, 1, article, { publishBy: 'fixture-editor', region: 'NG' });
  const publicCopy = await findNews(id);
  assert.equal(publicCopy.title, article.headline);
  assert.equal(publicCopy.region, 'NG');
  assert.ok((await listNews({ region: 'NG' })).items.some((item) => item.id === id));
  assert.ok(!(await listNews({ region: 'AF' })).items.some((item) => item.id === id));
  assert.deepEqual(publicCopy.sections, article.sections);
  assert.equal(publicCopy.articleEvidence, undefined);
  await saveArticle(id, 2, { ...article, headline: 'Another draft headline' }, { region: 'GLOBAL' });
  assert.equal((await findNews(id)).region, 'NG');
  assert.equal((await findNews(id)).title, article.headline);
  await assert.rejects(saveArticle(id, 2, article, { publishBy: 'fixture-editor' }), { statusCode: 409 });

  await prisma.npEvent.update({ where: { id }, data: { reviewStatus: 'dismissed' } });
  assert.equal(await findNews(id), null);
  const rejected = await rejectedStories(null, 'Records audit at two libraries');
  assert.ok(rejected.items.some((row) => row.id === id && row.dismissed));
  await assert.rejects(restoreStory(id, 3, 'unknown', 'fixture-admin'), { statusCode: 400 });
  const attempts = await Promise.allSettled([
    restoreStory(id, 3, 'AF', 'fixture-admin'), restoreStory(id, 3, 'AF', 'fixture-admin'),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((r) => r.status === 'rejected').reason.statusCode, 409);
  assert.equal(await findNews(id), null);
  const row = await prisma.npEvent.findUnique({ where: { id } });
  assert.equal(row.articleDraft.region, 'AF');
  assert.equal(row.cyberRegion, 'AF');
  assert.equal(row.restoredBy, 'fixture-admin');
  assert.ok(row.restoredAt);
  assert.ok(!(await rejectedStories(null, 'Records audit at two libraries')).items.some((item) => item.id === id));
  await saveArticle(id, 4, article, { publishBy: 'fixture-editor' });
  assert.equal((await findNews(id)).region, 'AF');
});
