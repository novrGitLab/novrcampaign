import type { Edition, Story } from '@/lib/news';
import { newsDate, getEdition } from '@/lib/news';
import { notFound } from 'next/navigation';

export function Byline({ story }: { story: Story }) {
  return (
    <p className="byline">
      <span className={'tone-' + story.presentation.tone}>{story.desk}</span>
      <span>{story.source}</span>
      <time dateTime={story.publishedAt}>{newsDate(story.publishedAt)}</time>
    </p>
  );
}
function Headline({ story }: { story: Story }) {
  return (
    <a className={'headline emphasis-' + story.presentation.emphasis} href={story.href}>
      {story.title}
    </a>
  );
}
export function NewsIndex({ stories }: { stories: Story[] }) {
  return (
    <div className="index-grid">
      {stories.map((story) => (
        <IndexStory key={story.id} story={story} />
      ))}
    </div>
  );
}
function IndexStory({ story }: { story: Story }) {
  return (
    <article className="index-story">
      <Byline story={story} />
      <h3>
        <Headline story={story} />
      </h3>
    </article>
  );
}
export function Photograph({ image, inline = false }: { image?: Story['image']; inline?: boolean } = {}) {
  if (image)
    return (
      <figure className="cover">
        <img
          src={image.url}
          alt={image.alt}
          fetchPriority={inline ? 'auto' : 'high'}
          loading={inline ? 'lazy' : 'eager'}
        />
        {image.credit && (
          <figcaption>{image.page ? <a href={image.page}>{image.credit}</a> : image.credit}</figcaption>
        )}
      </figure>
    );
  return (
    <figure className="cover">
      <img
        src="/press/network.jpg"
        width={1280}
        height={853}
        alt="Green and blue Ethernet cables connected to a server patch panel"
        fetchPriority="high"
      />
      <figcaption>
        Edition photograph · <a href="https://www.pexels.com/photo/1597776/">Brett Sayles / Pexels</a>
      </figcaption>
    </figure>
  );
}
function Spread({ items }: { items: Edition['items'] }) {
  const [lead, ...rest] = items;
  if (!lead)
    return (
      <div className="empty-edition">
        <Photograph />
        <div>
          <h2>No stories in this edition yet.</h2>
          <a className="read" href="#newsletter">
            Get the briefing
          </a>
        </div>
      </div>
    );
  return (
    <>
      <div className="spread">
        <article className="lead">
          <Photograph image={lead.image} />
          <Byline story={lead} />
          <h2>
            <Headline story={lead} />
          </h2>
          {lead.summary && <p className="standfirst">{lead.summary}</p>}
          <a className="read" href={lead.href}>
            Read story
          </a>
        </article>
        {rest.length > 0 && (
          <aside className="rail">
            <h2>On the wire</h2>
            {rest.slice(0, 4).map((story) => (
              <IndexStory story={story} key={story.id} />
            ))}
          </aside>
        )}
      </div>
      {rest.length > 4 && (
        <section className="more">
          <h2>More coverage</h2>
          <NewsIndex stories={rest.slice(4)} />
        </section>
      )}
    </>
  );
}
export async function EditionPage({ desk = '', after = '' }: { desk?: string; after?: string }) {
  if (desk && !['nigeria', 'africa', 'world'].includes(desk)) notFound();
  const edition = await getEdition(desk, after);
  const heading = desk ? desk[0].toUpperCase() + desk.slice(1) + ' edition' : 'The front page';
  return (
    <>
      <div className="section-title">
        <span className="signal" />
        <h1>
          {heading}
          {after ? ' · Archive' : ''}
        </h1>
      </div>
      <Spread items={edition.items} />
      {edition.next && (
        <a className="read older" href={'?after=' + edition.next}>
          Earlier stories
        </a>
      )}
    </>
  );
}
