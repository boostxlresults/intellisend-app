export const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

export const HELP_KEYWORDS = ['HELP', 'INFO'];

export const OPTIN_KEYWORDS = ['Y', 'YES', 'YEP', 'YA', 'YEAH'];

export function isStopKeyword(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return STOP_KEYWORDS.includes(normalized);
}

export function isHelpKeyword(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return HELP_KEYWORDS.includes(normalized);
}

export function isOptInKeyword(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return OPTIN_KEYWORDS.includes(normalized);
}

export function containsStopKeyword(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return STOP_KEYWORDS.some(keyword => normalized.includes(keyword));
}
