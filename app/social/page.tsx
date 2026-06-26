import type { Metadata } from 'next';
import SocialBoard, { type Manifest } from './SocialBoard';
import content from './content.json';

export const metadata: Metadata = {
  title: 'Yosuku · social',
  description: 'Internal social content board.',
  robots: { index: false, follow: false },
};

export default function SocialPage() {
  return <SocialBoard content={content as unknown as Manifest} />;
}
