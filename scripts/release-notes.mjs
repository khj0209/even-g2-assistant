#!/usr/bin/env node
// Prints release notes for Even Hub (max 500 chars): the given text, or the commit subjects
// since the previous release (the last v* tag, or else the previous commit that changed app.json,
// since releases from the work branch bump the version without tagging).
// Usage: node scripts/release-notes.mjs [text]
import { execFileSync } from 'node:child_process';
import { truncateNotes } from './release-lib.mjs';

const given = process.argv.slice(2).join(' ').trim();
if (given) {
  console.log(truncateNotes(given));
  process.exit(0);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let range = 'HEAD';
try {
  const prev = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^');
  range = `${prev}..HEAD`;
} catch {
  // No tag: the release before this one is the previous commit that changed app.json.
  const bumps = git('log', '--format=%H', '-n', '2', '--', 'app.json').split('\n').filter(Boolean);
  if (bumps.length === 2) range = `${bumps[1]}..HEAD`;
}
const subjects = git('log', '--no-merges', '--format=%s', range)
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !/^v?\d+\.\d+\.\d+$/.test(s) && !/^bump version/i.test(s));
console.log(truncateNotes(subjects.length ? subjects.map((s) => `- ${s}`).join('\n') : 'Bug fixes and improvements.'));
