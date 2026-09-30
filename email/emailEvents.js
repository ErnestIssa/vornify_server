const emailStore = require('./emailStore');
const { STATUS } = require('./emailTypes');

const SENDGRID_EVENT_MAP = {
  processed: STATUS.ACCEPTED,
  delivered: STATUS.DELIVERED,
  open: STATUS.OPENED,
  click: STATUS.CLICKED,
  bounce: STATUS.BOUNCED,
  dropped: STATUS.DROPPED,
  deferred: STATUS.DEFERRED,
  spamreport: STATUS.SPAM_REPORTED,
  blocked: STATUS.BLOCKED,
};

const STATUS_RANK = {
  [STATUS.QUEUED]: 1,
  [STATUS.PROCESSING]: 2,
  [STATUS.ACCEPTED]: 3,
  [STATUS.DEFERRED]: 4,
  [STATUS.DELIVERED]: 5,
  [STATUS.OPENED]: 6,
  [STATUS.CLICKED]: 7,
  [STATUS.BOUNCED]: 90,
  [STATUS.DROPPED]: 91,
  [STATUS.BLOCKED]: 92,
  [STATUS.SPAM_REPORTED]: 93,
  [STATUS.FAILED]: 94,
  [STATUS.DEAD_LETTER]: 95,
};

function shouldApplyStatus(current, next) {
  if (!current) return true;
  if (current === next) return false;
  const curRank = STATUS_RANK[current] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;
  if (curRank >= 90 && nextRank < 90) return false;
  return nextRank >= curRank;
}

function eventDedupeKey(ev) {
  const id = ev.sg_event_id || ev['smtp-id'] || ev.sg_message_id;
  const type = ev.event;
  const email = ev.email;
  return `${id || 'unknown'}:${type}:${email || ''}:${ev.timestamp || ''}`;
}

async function ingestSendGridEvents(events) {
  const list = Array.isArray(events) ? events : [events];
  const summary = { processed: 0, matched: 0, unmatched: 0, skipped: 0 };

  for (const ev of list) {
    summary.processed += 1;
    const eventType = SENDGRID_EVENT_MAP[ev.event];
    if (!eventType) continue;

    const messageId = ev.sg_message_id || ev['smtp-id'] || null;
    let msg = null;
    if (messageId) {
      const cleanId = String(messageId).split('.')[0];
      msg = await emailStore.findByProviderMessageId(cleanId);
      if (!msg && messageId) {
        msg = await emailStore.findByProviderMessageId(messageId);
      }
    }

    if (!msg) {
      summary.unmatched += 1;
      continue;
    }

    const dedupeKey = eventDedupeKey(ev);
    const priorEvents = Array.isArray(msg.events) ? msg.events : [];
    if (priorEvents.some((e) => e.dedupeKey === dedupeKey)) {
      summary.skipped += 1;
      continue;
    }

    if (!shouldApplyStatus(msg.status, eventType)) {
      summary.skipped += 1;
      await emailStore.appendEvent(msg.emailId, {
        type: eventType,
        providerEvent: ev.event,
        dedupeKey,
        ignored: true,
        reason: 'status_not_advanced',
      });
      continue;
    }

    if (eventType === STATUS.SPAM_REPORTED || eventType === STATUS.BOUNCED) {
      const recipient = ev.email ? String(ev.email).trim().toLowerCase() : null;
      if (recipient) {
        const marketing = require('../services/subscriberMarketingService');
        marketing
          .applyProviderSuppression({
            email: recipient,
            source: eventType === STATUS.SPAM_REPORTED ? 'spam-complaint' : 'bounce',
          })
          .catch(() => {});
      }
    }

    summary.matched += 1;
    const patch = { status: eventType };
    if (eventType === STATUS.DELIVERED) {
      patch.deliveredAt = new Date(ev.timestamp * 1000).toISOString();
    }
    await emailStore.updateMessage(msg.emailId, patch);
    await emailStore.appendEvent(msg.emailId, {
      type: eventType,
      providerEvent: ev.event,
      dedupeKey,
      reason: ev.reason,
      response: ev.response,
    });
  }

  return summary;
}

module.exports = {
  ingestSendGridEvents,
  shouldApplyStatus,
};
