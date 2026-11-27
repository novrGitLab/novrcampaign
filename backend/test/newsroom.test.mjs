import test from 'node:test';
import assert from 'node:assert/strict';
import { completeEdition, mediaUrl } from '../src/services/editionReview.js';
import { publicStory, safeUrl } from '../src/services/publicNews.js';
import { renderBriefingPreview, groupStories } from '../src/services/novrpulse/briefingPreview.js';

test('all ten sections need an editorial decision', () => {
  const sections = Array.from({ length: 10 }, (_, i) => ({
    functionId: i + 1,
    state: 'no_updates',
    items: [],
  }));
  assert.ok(completeEdition(sections));
  assert.equal(completeEdition(sections.slice(0, 8)), false);
  sections[9].items.push({ id: 'quiz' });
  assert.equal(completeEdition(sections), false);
  sections[9].state = 'ready';
  assert.ok(completeEdition(sections));
});
test('public news projects source attribution and excludes internal notes and full text', () => {
  const row = {
    id: 'story',
    title: 'New security guidance',
    summary: 'A regulator updated its guidance.',
    body: 'Internal full text',
    canonicalUrl: 'https://example.org/news',
    publishedAt: new Date(),
    sources: [{ rawDocument: { source: { name: 'Example' } } }],
  };
  const publicItem = publicStory(row);
  assert.equal(publicItem.source, 'Example');
  assert.ok(!('body' in publicItem));
  assert.ok(!('sources' in publicItem));
  assert.equal(publicStory({ ...row, title: 'Police arrest a suspect' }), null);
  assert.equal(publicStory({ ...row, canonicalUrl: null }), null);
});
test('email uses the edited headlines, photos, forum, tool and quiz', () => {
  const sections = [2, 9, 10].map((functionId) => ({
    functionId,
    items: [
      {
        imageUrl: 'https://images.pexels.com/photos/1/image.jpg',
        imageAlt: 'A network switch',
        imageCredit: 'Photographer',
        publishItem: {
          functionId,
          event: { title: 'Original headline' },
          body: 'Edited headline ' + functionId + '\n\nA <short> paragraph.',
        },
      },
    ],
  }));
  const html = renderBriefingPreview({
    date: '27 November',
    groups: groupStories(sections),
    unsubscribeUrl: '{{unsubscribeUrl}}',
  });
  for (const term of [
    'Tool Spotlight',
    'Forum Topic',
    'Quiz',
    'Edited headline 10',
    'A network switch',
    'Photographer',
    '&lt;short&gt;',
    '{{unsubscribeUrl}}',
  ])
    assert.ok(html.includes(term), term);
  assert.equal(html.includes('Original headline'), false);
  assert.equal(mediaUrl('https://other.example/photo'), null);
  assert.equal(safeUrl('javascript:void(0)'), null);
});
