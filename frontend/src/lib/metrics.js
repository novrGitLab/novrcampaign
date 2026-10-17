/**
 * Shared metric glossary — the source of truth for every tooltip in the app.
 * Keep each entry short enough to read in a 240px popover.
 */
export const TIP = {
  totalContacts:
    'Everyone in your Plunk project who is not suppressed (unsubscribed, hard-bounced or complained).',
  sent:
    'Emails Plunk accepted from you and handed to the recipient mail servers.',
  delivered:
    'Emails the recipient server accepted. Delivered = Sent − hard bounces − permanent failures.',
  deliveryRate: 'Delivery rate = Delivered ÷ Sent × 100.',
  openRate: 'Open rate = unique recipients who opened at least once ÷ Sent × 100.',
  clickRate: 'Click rate = unique recipients who clicked at least one link ÷ Sent × 100.',
  opens: 'Unique recipients who opened the email at least once (repeat opens are not counted twice).',
  clicks: 'Unique recipients who clicked at least one link in the email.',
  recipients: 'Contacts in this campaign’s audience — a segment, or your whole list.',
  unsubscribed:
    'Recipients who clicked the unsubscribe link. They are added to suppressions and excluded from every future send.',
  bounced:
    'Emails the recipient server rejected. Hard bounces (invalid or dead mailboxes) permanently suppress the address; soft bounces are temporary and retried on the next send.',
  softBounces:
    'Temporary rejections — full mailbox, greylisting or timeout. The contact stays subscribed and Plunk retries on the next send.',
  complained:
    'Recipients who marked your email as spam. Above ~0.1% of sends this puts sender reputation at risk.',
  suppressed:
    'Addresses on the do-not-deliver list: unsubscribes + hard bounces + spam complaints. They are excluded from all future campaigns.',
  errorRate:
    'Error rate = (Bounced + Spam complaints) ÷ Sent × 100 — the share of sends that hurt sender reputation.',
  weekDelta:
    'Change versus the previous week = (this week − last week) ÷ last week × 100.',
  unsubRate: 'Unsub rate = Unsubscribed ÷ Sent × 100.',
  campaignsSent: 'Campaigns whose status is SENT (drafts and scheduled sends are excluded).',
};

export default TIP;
