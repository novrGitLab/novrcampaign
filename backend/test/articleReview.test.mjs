import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/prisma.js';
import { findNews } from '../src/services/publicNews.js';
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
  await saveArticle(id, 1, article, { publishBy: 'fixture-editor' });
  const publicCopy = await findNews(id);
  assert.equal(publicCopy.title, article.headline);
  assert.deepEqual(publicCopy.sections, article.sections);
  assert.equal(publicCopy.articleEvidence, undefined);
  await saveArticle(id, 2, { ...article, headline: 'Another draft headline' });
  assert.equal((await findNews(id)).title, article.headline);
  await assert.rejects(saveArticle(id, 2, article, { publishBy: 'fixture-editor' }), { statusCode: 409 });
});
