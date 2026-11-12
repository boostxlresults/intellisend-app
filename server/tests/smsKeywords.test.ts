import test from 'node:test';
import assert from 'node:assert/strict';
import { isStopKeyword, isStopOrNegative, isOptInKeyword, isHelpKeyword } from '../src/utils/smsKeywords';

const mustOptOut = [
  'STOP', 'stop', 'Stop.', 'STOP!', ' stop ', 'STOP!!!', 'Stop please', 'please stop', 'Please stop.',
  'pls stop', 'stop now', 'STOP ALL', 'STOPALL', 'stop texting me', 'Stop texting me!', 'please stop texting me',
  'stop sending me messages', 'UNSUBSCRIBE', 'unsubscribe.', 'Unsubscribe me', 'please unsubscribe me from this list',
  'CANCEL', 'cancel.', 'END', 'QUIT', 'quit!', 'REVOKE', 'revoke', 'I revoke consent', 'I revoke my consent to be texted',
  'opt out', 'OPT OUT', 'Opt-out', 'optout', 'opt me out', 'I want to opt out', 'please opt me out of these',
  'remove me from your list', 'take me off your list', 'Take me off this list please', 'remove me',
  "don't text me", 'Don’t text me again', 'do not text me', 'DO NOT CONTACT', 'stop messaging me', 'leave me alone',
  'Remove me.', 'this is spam',
];
const mustNotOptOut = [
  '', 'yes', 'Y', 'What time can you come by?', "I can't stop by today, how about Friday?", 'Can you stop by tomorrow at 3?',
  'Please cancel my appointment for Tuesday', 'cancel please', 'Can we end at noon?', 'The leak will not stop',
  'My AC will not stop running', 'I quit my job so mornings work now', 'How much is a water heater flush?',
  'Do not come before 9', 'ok thanks', 'HELP', 'When does the offer end?', 'stop by the office anytime',
];

test('opt-out wording is recognized', () => {
  for (const msg of mustOptOut) assert.equal(isStopOrNegative(msg), true, `should opt out: "${msg}"`);
});
test('ordinary replies are not treated as opt-outs', () => {
  for (const msg of mustNotOptOut) assert.equal(isStopOrNegative(msg), false, `should NOT opt out: "${msg}"`);
});
test('FCC keywords are caught by the keyword check itself', () => {
  for (const msg of ['stop', 'quit', 'end', 'revoke', 'opt out', 'cancel', 'unsubscribe', 'Stop.', 'REVOKE!'])
    assert.equal(isStopKeyword(msg), true, msg);
});
test('opt-in and help tolerate punctuation', () => {
  assert.equal(isOptInKeyword('Yes!'), true);
  assert.equal(isOptInKeyword('yes please'), false);
  assert.equal(isHelpKeyword('help?'), true);
});
