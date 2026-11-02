import test from 'node:test';
import assert from 'node:assert/strict';
import { writeState } from '../src/persistence.mjs';

test('transient Windows replacement locks preserve the last complete state and retry', async () => {
  let saved = 'previous', temp, attempts = 0;
  const pauses = [];
  await writeState('state.json', 'next', {
    writeFile: async (_file, value) => { temp = value; },
    rename: async () => {
      assert.equal(saved, 'previous');
      if (++attempts < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      saved = temp;
    },
  }, async (ms) => { pauses.push(ms); });
  assert.equal(saved, 'next'); assert.equal(attempts, 3); assert.deepEqual(pauses, [25, 50]);
});
