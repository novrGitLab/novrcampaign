import { prisma } from '../utils/prisma.js';
import { sendStaffNotice } from './plunkService.js';
import { publicOrigin } from './newsroomPhoto.js';
import logger from '../utils/logger.js';

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const descriptions = {
  WELCOME: [
    'Staff identity verified',
    'Your staff account is verified. To join the newsroom, sign in and select Request access.',
  ],
  RECEIVED: [
    'Access request received',
    'A newsroom administrator will review your request. A decision will arrive at this address.',
  ],
  DECLINED: [
    'Newsroom access request declined',
    'A newsroom administrator declined your access request. Contact the editorial team if you need a further review.',
  ],
};
export function noticeContent(notice) {
  const r = notice.request;
  const [subject, body] =
    descriptions[notice.kind] ??
    (notice.kind === 'REVIEW'
      ? ['Newsroom access request', escape(r.name) + ' (' + escape(r.email) + ') requested newsroom access.']
      : [
          'Newsroom access granted',
          'Your newsroom access was approved with the ' +
            escape(r.role) +
            ' role. Sign in with your staff account.',
        ]);
  const review = notice.kind === 'REVIEW';
  const link = review ? '/staff-access' : '/login';
  return {
    subject: 'NovrPulse · ' + subject,
    body:
      '<h1>' +
      subject +
      '</h1><p>' +
      body +
      '</p><p><a href="' +
      publicOrigin +
      link +
      '">' +
      (review ? 'Review access requests' : 'Staff sign-in') +
      '</a></p>',
  };
}

export async function deliverStaffNotices(send = sendStaffNotice, requestId) {
  const now = new Date();
  const notices = await prisma.staffAccessNotice.findMany({
    where: { requestId, sentAt: null, availableAt: { lte: now } },
    include: { request: true },
    orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  for (const notice of notices) {
    const claimed = await prisma.staffAccessNotice.updateMany({
      where: { id: notice.id, sentAt: null, availableAt: { lte: now } },
      data: { availableAt: new Date(Date.now() + 10 * 60000), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    try {
      await send(notice.recipient, noticeContent(notice), notice.id);
      await prisma.staffAccessNotice.update({ where: { id: notice.id }, data: { sentAt: new Date() } });
    } catch {
      await prisma.staffAccessNotice.update({
        where: { id: notice.id },
        data: {
          availableAt: new Date(Date.now() + Math.min(180, 2 ** Math.min(notice.attempts, 8)) * 60000),
        },
      });
      logger.warn({ noticeId: notice.id }, 'Staff access email delivery will retry');
    }
  }
}
