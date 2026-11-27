type Pose = 'perched' | 'flight';

export function PulseKingfisher({ pose = 'perched' }: { pose?: Pose }) {
  return (
    <svg
      className="pulse-kingfisher"
      data-pose={pose}
      viewBox="0 0 104 80"
      fill="none"
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="kingfisher-tail">
        <path className="bird-crown bird-edge" d="m35 44-11 16-18 4 12-11-10 2 14-10Z" />
        <path className="bird-crease" d="m14 59 14-10" />
      </g>
      {pose === 'perched' && (
        <g className="kingfisher-feet bird-pen">
          <path d="m44 59-2 10-7 2m7-2 4 3m9-12-1 8 6 2m-6-2-5 3" />
        </g>
      )}
      <path className="bird-back bird-edge" d="M24 49c3-13 11-23 26-28 8-3 19 1 22 8 3 7 0 14-2 19-5 13-15 20-29 18-9-2-15-8-17-17Z" />
      <path className="bird-cheek" d="M57 34c5-3 11-4 16-3-3 7-2 13-6 19-4 7-9 11-14 13 4-5 5-10 4-15-1-5-1-10 0-14Z" />
      <g className="kingfisher-head">
        <path className="bird-crown bird-edge" d="M39 25c2-4 5-7 8-9l-8-1 10-4-6-4 12 1-2-5 12 5c7 1 13 7 14 14l-3 8c-5 5-12 7-20 5l-8-7Z" />
        <path className="bird-back" d="M43 23c6 0 11 2 17 5 5 2 11 2 16-1-3 6-9 9-15 9-8-1-14-5-18-13Z" />
        <path className="bird-paper" d="M52 27c4-3 8-6 13-8 4-1 8 0 10 3-5-1-7 1-10 4-4 3-7 5-11 5l3-4Z" />
        <path className="bird-beak bird-edge" d="m74 24 26-3-10 7-16 3Z" />
        <path className="bird-beak-line" d="m76 28 17-4" />
        <ellipse className="bird-ink" cx="69" cy="21.7" rx="3.4" ry="3.7" />
        <circle className="bird-glint" cx="70" cy="20.3" r="1.05" />
        <path className="bird-crest-line" d="m51 13 5 2m2-4 4 3" />
      </g>
      <g className="kingfisher-wing">
        <path className="bird-crown bird-edge" d="M57 36c-10-4-20-1-26 4l-15 14 13-2-4 5c9 0 18-3 25-7 6-4 9-10 7-14Z" />
        <path className="bird-paper bird-edge" d="m53 34-17 3-13 15 14-4 10 1Z" />
        <path className="bird-fold bird-edge" d="m53 34-6 15-8-4Z" />
        <path className="bird-type" d="m35 41 8-2m-12 7 8-2" />
      </g>
    </svg>
  );
}
