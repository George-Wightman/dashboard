import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore } from '../claude/files.js';
import { fakeApi } from './helpers.js';

const store = (initial) => {
  const fetch = fakeApi(initial);
  return { files: createFileStore({ token: 'github_pat_TESTKEY0123456789abcdef', repo: 'o/r', fetch }), raw: fetch.files };
};

test('read gives a file back, and null when there is none', async () => {
  const { files } = store({ 'handoffs/a.md': 'hello' });
  assert.equal((await files.read('handoffs/a.md')).text, 'hello');
  assert.equal(await files.read('handoffs/b.md'), null);
});

test('a file of any length goes up and comes back whole', async () => {
  const { files } = store();
  const long = `${'x'.repeat(5000)}\nand a line after it\n`;
  await files.write('handoffs/a.md', long, 'add');
  assert.equal((await files.read('handoffs/a.md')).text, long);
});

test('list gives the files in a directory, and nothing from below it', async () => {
  const { files } = store({ 'handoffs/a.md': '1', 'handoffs/b.md': '2', 'handoffs/done/c.md': '3' });
  assert.deepEqual((await files.list('handoffs')).map((f) => f.name).sort(), ['a.md', 'b.md']);
});

test('a directory nothing has been written to yet is simply empty', async () => {
  const { files } = store();
  assert.deepEqual(await files.list('handoffs'), []);
});

test('move leaves the text at the new path and nothing at the old', async () => {
  const { files, raw } = store({ 'handoffs/a.md': 'hello' });
  await files.move('handoffs/a.md', 'handoffs/done/a.md');
  assert.equal(raw.get('handoffs/done/a.md'), 'hello');
  assert.equal(raw.has('handoffs/a.md'), false);
});

test('move says which file it could not find', async () => {
  const { files } = store();
  await assert.rejects(() => files.move('handoffs/a.md', 'handoffs/done/a.md'), /No file at handoffs\/a\.md/);
});

test('a refused key reads as a sentence about the key, not a status code', async () => {
  const files = createFileStore({
    token: 't', repo: 'o/r', fetch: async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }),
  });
  await assert.rejects(() => files.list('handoffs'), /refused the access key/);
});
