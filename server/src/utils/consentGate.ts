/**
 * Consent gate for contacts synced from the ServiceTitan mirror.
 *
 * A phone number a customer gave us for service ('st_service'), or one we only
 * know from caller ID ('st_call_history'), is not marketing consent. Those
 * contacts can only receive a PSA (opt-in request) campaign until they reply
 * YES, which sets consentTimestamp. Call-history numbers are blocked even for
 * PSA unless ALLOW_CALL_HISTORY_PSA=true, because we cannot be sure the number
 * still belongs to the customer.
 *
 * Contacts not managed by the mirror (consentClass null) are unaffected.
 */
export function blockedByConsent(
  contact: { consentTimestamp?: Date | null; consentClass?: string | null },
  campaignType: string
): boolean {
  if (contact.consentTimestamp) return false;
  if (contact.consentClass === 'st_service') return campaignType !== 'PSA';
  if (contact.consentClass === 'st_call_history') {
    return campaignType !== 'PSA' || process.env.ALLOW_CALL_HISTORY_PSA !== 'true';
  }
  return false;
}
