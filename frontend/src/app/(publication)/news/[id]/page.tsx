import { headers } from 'next/headers';
import { Photograph, Byline, NewsIndex } from '@/components/public/Edition';
import { getStory, editionMeta, site } from '@/lib/news';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props) {
  const { story } = await getStory((await params).id);
  const meta = editionMeta(story.title + ' | NovrPulse', story.href, story.summary || story.title);
  return {
    ...meta,
    openGraph: {
      ...meta.openGraph,
      type: 'article',
      publishedTime: story.publishedAt,
      ...(story.image ? { images: [{ url: story.image.url, alt: story.image.alt }] } : {}),
    },
  };
}
export default async function Article({ params }: Props) {
  const { story, related } = await getStory((await params).id);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: story.title,
    datePublished: story.publishedAt,
    mainEntityOfPage: site + story.href,
    publisher: { '@type': 'Organization', name: 'NovrPulse' },
    citation: story.sourceUrl,
    ...(story.updatedAt && {dateModified:story.updatedAt}),
    articleSection: story.desk,
    description: story.summary,
    inLanguage: 'en',
    ...(story.image ? { image: story.image.url } : {}),
  };
  return (
    <>
      <script
        nonce={(await headers()).get('x-nonce') || undefined}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }}
      />
      <article className="article">
        <a className="back" href="/">
          ← Front page
        </a>
        <Byline story={story} />
        {story.format === "brief" && <p className="article-format">News brief</p>}
        <h1>{story.title}</h1>
        {story.image && <Photograph image={story.image} />}
        {story.summary && <p className="standfirst">{story.summary}</p>}
        {story.sections?.map((section,i) => <section className="article-section" key={i}><h2>{section.heading}</h2>{section.paragraphs.map((p,j) => <p key={j}>{p}</p>)}</section>)}
        {story.context && story.context !== story.summary && (
          <>
            <h2>Why it matters</h2>
            <p>{story.context}</p>
          </>
        )}
        <a className="read" href={story.sourceUrl}>
          Read the original at {story.source}
        </a>
      </article>
      {related.length > 0 && (
        <section className="more">
          <h2>Related coverage</h2>
          <NewsIndex stories={related} />
        </section>
      )}
    </>
  );
}
