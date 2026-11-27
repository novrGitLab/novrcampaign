import Image from 'next/image';

export function PublisherLogo() {
  return (
    <a className="publisher-logo" href="https://cybernovr.com">
      <Image src="/press/cybernovr-wordmark.png" alt="CyberNovr" width={972} height={98} unoptimized />
    </a>
  );
}
