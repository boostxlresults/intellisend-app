export const STOP_KEYWORDS = ['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT OUT'];

/**
 * Keywords that still mean "opt out" when the customer adds a polite or
 * filler word ("please stop", "Stop texting me", "unsubscribe me please").
 * CANCEL, END and QUIT are left out on purpose: with extra words they are
 * usually about an appointment ("cancel please"), so they only count alone.
 */
const STRONG_STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'REVOKE', 'OPTOUT']);
const STOP_FILLER_WORDS = new Set([
  'PLEASE', 'PLS', 'PLZ', 'NOW', 'THANKS', 'THANK', 'YOU', 'ME', 'ALL', 'IT', 'THIS', 'THESE',
  'TEXTING', 'TEXTS', 'TEXT', 'MESSAGING', 'MESSAGES', 'SENDING', 'CONTACTING', 'MSGS',
]);
/** Opt-out wording that counts anywhere in a message. */
const STOP_PHRASE_PATTERNS = [
  /\bUNSUBSCRIBE\b/,
  /\bREVOKE\b/,
  /\bOPT(ING)? (ME )?OUT\b/,
  /\bOPTOUT\b/,
  /\b(REMOVE|TAKE) ME (OFF|FROM)\b/,
];

/**
 * Uppercase, straighten curly apostrophes, drop punctuation and collapse
 * spaces, so "Stop.", " STOP!! " and "stop" all compare equal.
 */
export function normalizeKeywordText(body: string | undefined | null): string {
  if (!body) return '';
  return body
    .toUpperCase()
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .replace(/[^A-Z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const HELP_KEYWORDS = ['HELP', 'INFO'];

export const OPTIN_KEYWORDS = ['Y', 'YES', 'YEP', 'YA', 'YEAH'];

const NEGATIVE_SENTIMENT_EXACT = [
  'FUCK OFF',
  'F OFF',
  'FUCK YOU',
  'F U',
  'FU',
  'FUCK THIS',
  'EAT SHIT',
  'GO TO HELL',
  'LEAVE ME ALONE',
  'PISS OFF',
  'SCREW YOU',
  'SCREW OFF',
  'BUZZ OFF',
  'GET LOST',
  'DROP DEAD',
  'KISS MY ASS',
  'BITE ME',
  'GFY',
  'GTFO',
  'STFU',
  'GO AWAY',
  'DELETE MY NUMBER',
  'REMOVE MY NUMBER',
  'LOSE MY NUMBER',
  'TAKE ME OFF YOUR LIST',
  'REMOVE ME',
  'DELETE ME',
];

const NEGATIVE_SENTIMENT_PHRASES = [
  'STOP TEXTING',
  'STOP MESSAGING',
  'STOP CONTACTING',
  'STOP SENDING',
  'QUIT TEXTING',
  'QUIT MESSAGING',
  'QUIT SENDING',
  'DONT TEXT',
  "DON'T TEXT",
  'DONT MESSAGE',
  "DON'T MESSAGE",
  'DONT CONTACT',
  "DON'T CONTACT",
  'DONT SEND',
  "DON'T SEND",
  'NEVER TEXT',
  'NEVER MESSAGE',
  'NEVER CONTACT',
  'DO NOT TEXT',
  'DO NOT MESSAGE',
  'DO NOT CONTACT',
  'STOP SPAMMING',
  'QUIT SPAMMING',
  'THIS IS SPAM',
  'YOURE SPAM',
  "YOU'RE SPAM",
  'REPORTED SPAM',
  'REPORTING SPAM',
  'REPORTED YOU FOR SPAM',
  'REPORTING YOU FOR SPAM',
  'HARASSING ME',
  'STOP HARASSING',
];

export function isStopKeyword(body: string | undefined | null): boolean {
  const normalized = normalizeKeywordText(body);
  if (!normalized) return false;
  if (STOP_KEYWORDS.includes(normalized)) return true;
  if (STOP_PHRASE_PATTERNS.some(pattern => pattern.test(normalized))) return true;

  // Short messages made only of an opt-out word plus filler: "PLEASE STOP", "STOP TEXTING ME".
  const words = normalized.split(' ');
  if (words.length <= 6 && words.some(w => STRONG_STOP_WORDS.has(w))) {
    return words.every(w => STRONG_STOP_WORDS.has(w) || STOP_FILLER_WORDS.has(w));
  }
  return false;
}

/**
 * Hostile wording aimed at the sender, matched anywhere in the message.
 * Swearing about something else ("my damn AC broke again") is not an opt-out.
 */
const HOSTILE_PATTERNS = [
  /\b(FUCK|FUCKING|FCK|FUK|FK|F|SCREW|EFF) (YOU|U|YOURSELF|YOURSELVES|OFF|YALL|Y'ALL|YA)\b/,
  /\bGO (FUCK|FCK|F|SCREW) (YOURSELF|YOURSELVES)\b/,
  /\b(STFU|GFY|GTFO|FOAD)\b/,
  /\b(EAT SHIT|GO TO HELL|PISS OFF|KISS MY ASS|BITE ME|DROP DEAD|LEAVE ME ALONE|LOSE MY NUMBER)\b/,
  /\b(DELETE|REMOVE) MY (NUMBER|PHONE|INFO|INFORMATION)\b/,
];

/** Turn masked swearing ("f*** you", "f%^* you", "f**k off") back into the plain word. */
function unmaskProfanity(body: string): string {
  return body
    .toUpperCase()
    // "f/u" is shorthand for "follow up", not an insult.
    .replace(/\bF\/U\b/g, 'FOLLOWUP')
    .replace(/\bF[*@#$%^&!_.\-]+(?:C?K(?:ING)?)?(?=\s|$|[.,!?])/g, 'FUCK');
}

export function isNegativeSentiment(body: string | undefined | null): boolean {
  const normalized = normalizeKeywordText(body ? unmaskProfanity(body) : body);
  if (!normalized) return false;

  if (normalized === 'FUCK' || HOSTILE_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true;
  }

  if (NEGATIVE_SENTIMENT_EXACT.includes(normalized)) {
    return true;
  }

  if (NEGATIVE_SENTIMENT_PHRASES.some(phrase => normalized.includes(phrase))) {
    return true;
  }

  return false;
}

export function isStopOrNegative(body: string | undefined | null): boolean {
  return isStopKeyword(body) || isNegativeSentiment(body);
}

export function isHelpKeyword(body: string | undefined | null): boolean {
  const normalized = normalizeKeywordText(body);
  if (!normalized) return false;
  return HELP_KEYWORDS.includes(normalized);
}

export function isOptInKeyword(body: string | undefined | null): boolean {
  const normalized = normalizeKeywordText(body);
  if (!normalized) return false;
  return OPTIN_KEYWORDS.includes(normalized);
}

export function containsStopKeyword(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return STOP_KEYWORDS.some(keyword => normalized.includes(keyword));
}
