import type { SVGProps } from 'react';

const drawings = {
  newsroom: (
    <>
      <path d="M4 4.5h14v13.2a2.3 2.3 0 0 0 2.3 2.3H6.5A2.5 2.5 0 0 1 4 17.5Z" />
      <path d="M18 8h3v10.3a1.7 1.7 0 0 1-1.7 1.7M7 8h8M7 11h3.5v3.5H7zM13 11h2m-2 3h2m-8 3h8" />
    </>
  ),
  proof: (
    <>
      <path d="M12 20H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v4M7.5 7h6M7.5 10h4" />
      <path d="m13 16 5.8-5.8a1.5 1.5 0 0 1 2.1 2.1L15 18l-3 .9Zm4.8-4.8 2.1 2.1" />
    </>
  ),
  access: (
    <>
      <path d="M12 21s7.4-3.7 7.4-11V5.8L12 3 4.6 5.8V10c0 7.3 7.4 11 7.4 11Z" />
      <circle cx="12" cy="10.1" r="1.8" />
      <path d="M8.8 15.3a3.4 3.4 0 0 1 6.4 0" />
    </>
  ),
};
function symbol(name: keyof typeof drawings) {
  return function NewsroomIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {drawings[name]}
      </svg>
    );
  };
}
export const Newsroom = symbol('newsroom');
export const ArticleReview = symbol('proof');
export const StaffAccess = symbol('access');
