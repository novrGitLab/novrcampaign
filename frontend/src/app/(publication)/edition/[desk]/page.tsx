import { EditionPage } from '@/components/public/Edition';
import { editionMeta } from '@/lib/news';
type Props = { params: Promise<{ desk: string }>; searchParams: Promise<{ after?: string }> };
export async function generateMetadata({ params, searchParams }: Props) {
  const { desk } = await params;
  const { after } = await searchParams;
  return editionMeta(
    desk[0].toUpperCase() + desk.slice(1) + ' edition | NovrPulse',
    '/edition/' + desk + (after ? '?after=' + encodeURIComponent(after) : ''),
  );
}
export default async function Region({ params, searchParams }: Props) {
  return <EditionPage desk={(await params).desk} after={(await searchParams).after} />;
}
