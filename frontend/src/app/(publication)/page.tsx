import { EditionPage } from '@/components/public/Edition';
import { editionMeta } from '@/lib/news';
type Props = { searchParams: Promise<{ after?: string }> };
export async function generateMetadata({ searchParams }: Props) {
  const { after } = await searchParams;
  return editionMeta(
    'NovrPulse | Cybersecurity News',
    '/' + (after ? '?after=' + encodeURIComponent(after) : ''),
  );
}
export default async function Home({ searchParams }: Props) {
  return <EditionPage after={(await searchParams).after} />;
}
