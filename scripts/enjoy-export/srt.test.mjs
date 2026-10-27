import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineToSrt, formatSrtTime, SUBTITLE_MAX_CUES, SUBTITLE_MAX_BYTES } from './srt.mjs';

test('formatSrtTime renders HH:MM:SS,mmm with hours and rounded milliseconds', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(59999), '00:00:59,999');
  assert.equal(formatSrtTime(3723500), '01:02:03,500');
  assert.equal(formatSrtTime(36000000), '10:00:00,000');
});

test('timelineToSrt renders numbered cues from seconds', () => {
  const r = timelineToSrt([{ type: 'sentence', text: 'Hello there', startTime: 3723.5, endTime: 3725.25 }]);
  assert.equal(r.srt, '1\n01:02:03,500 --> 01:02:05,250\nHello there\n\n');
  assert.equal(r.cues, 1);
  assert.equal(r.bytes, Buffer.byteLength(r.srt, 'utf8'));
});

test('line breaks and runs of whitespace become single spaces', () => {
  const r = timelineToSrt([{ type: 'sentence', text: '  a\r\n  b\n\nc\t d  ', startTime: 0, endTime: 1 }]);
  assert.equal(r.srt, '1\n00:00:00,000 --> 00:00:01,000\na b c d\n\n');
});

test('drops empty text, non-numeric times and empty ranges, and counts them', () => {
  const r = timelineToSrt([
    { type: 'sentence', text: '   ', startTime: 0, endTime: 1 },
    { type: 'sentence', text: 'x', startTime: 'soon', endTime: 1 },
    { type: 'sentence', text: 'y', startTime: 2, endTime: 2 },
    { type: 'sentence', text: 'z', startTime: 3, endTime: 2 },
    { type: 'sentence', text: 'kept', startTime: 4, endTime: 5 },
    null,
    5,
  ]);
  assert.equal(r.cues, 1);
  assert.match(r.srt, /kept/);
  assert.deepEqual(r.dropped, { empty: 1, bad_time: 1, empty_range: 2, bad_entry: 2 });
});

test('a negative start is clamped to zero', () => {
  const r = timelineToSrt([{ type: 'sentence', text: 'a', startTime: -1, endTime: 2 }]);
  assert.equal(r.srt, '1\n00:00:00,000 --> 00:00:02,000\na\n\n');
});

test('sorts by start time and keeps overlapping cues as they are', () => {
  const r = timelineToSrt([
    { type: 'sentence', text: 'second', startTime: 5, endTime: 6 },
    { type: 'sentence', text: 'first', startTime: 1, endTime: 5.5 },
    { type: 'sentence', text: 'overlap', startTime: 5.2, endTime: 7 },
  ]);
  assert.deepEqual(
    r.srt.split('\n\n').filter(Boolean).map((b) => b.split('\n')[2]),
    ['first', 'second', 'overlap'],
  );
});

test('output has no BOM and uses LF line endings', () => {
  const r = timelineToSrt([{ type: 'sentence', text: 'a', startTime: 0, endTime: 1 }]);
  assert.equal(r.srt.charCodeAt(0), 0x31); // "1"
  assert.equal(r.srt.includes('\r'), false);
});

test('empty input gives an empty subtitle with zero cues', () => {
  const r = timelineToSrt([]);
  assert.deepEqual([r.srt, r.cues, r.bytes], ['', 0, 0]);
});

test('uses the server subtitle limits', () => {
  assert.equal(SUBTITLE_MAX_CUES, 20000);
  assert.equal(SUBTITLE_MAX_BYTES, 2 * 1024 * 1024);
});
