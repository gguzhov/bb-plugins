import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubUser, githubUrl } from '../new-tab.ts';
test('valid GitHub names and repositories URL', () => {
  for (const name of ['octocat', 'Octo-Cat', 'a', 'a'.repeat(39)]) assert.equal(githubUser(name), name);
  assert.equal(githubUrl('octocat'), 'https://github.com/octocat?tab=repositories');
});
test('invalid values fall back to the homepage', () => {
  for (const name of ['', null, 42, {}, 'a'.repeat(40), '-octocat', 'octocat-', 'octo--cat', 'octo_cat', ' octocat', 'octocat\n', 'кот', 'a/b', 'a?x=y', '<script>']) {
    assert.equal(githubUser(name), ''); assert.equal(githubUrl(name), 'https://github.com');
  }
});
