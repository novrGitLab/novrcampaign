'use client';

import { useEffect, useState } from 'react';
import rest from './kingfisher/rest.png';
import lift from './kingfisher/lift.png';
import spread from './kingfisher/spread.png';
import call from './kingfisher/call.png';

const pause = 24_000;
const gesture = [
  { icon: lift, hold: 160 }, { icon: spread, hold: 210 }, { icon: lift, hold: 160 },
  { icon: rest, hold: 170 }, { icon: lift, hold: 160 }, { icon: spread, hold: 220 },
  { icon: lift, hold: 160 }, { icon: rest, hold: 260 }, { icon: call, hold: 250 },
  { icon: rest, hold: 150 }, { icon: call, hold: 210 },
];

export function KingfisherFavicon() {
  const [icon, setIcon] = useState(rest.src);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number;

    function play(index: number) {
      if (document.hidden || motion.matches) return reset();
      const frame = gesture[index];
      if (!frame) {
        setIcon(rest.src);
        timer = window.setTimeout(() => play(0), pause);
        return;
      }
      setIcon(frame.icon.src);
      timer = window.setTimeout(() => play(index + 1), frame.hold);
    }

    function reset() {
      window.clearTimeout(timer);
      setIcon(rest.src);
      if (!document.hidden && !motion.matches) timer = window.setTimeout(() => play(0), 6000);
    }

    reset();
    motion.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  return <link rel="icon" type="image/png" sizes="64x64" href={icon} />;
}
