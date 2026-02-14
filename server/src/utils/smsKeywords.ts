export const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

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
  if (!body) return false;
  const normalized = body.trim().toUpperCase();
  return STOP_KEYWORDS.includes(normalized);
}

export function isNegativeSentiment(body: string | undefined | null): boolean {
  if (!body) return false;
  const normalized = body.trim().toUpperCase();

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
