import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { subcontractOutboundLabel, subcontractOutboundTimelineLabel } from '../src/lib/subcontracts/outbound.ts';

test('source clicks preserve listing and destination through the 128-character intake limit', () => {
  for (const source of ['SBA directory', 'GSA directory', 'DOT directory', 'USAspending', 'SBA SUBNet']) {
    const label = subcontractOutboundLabel(source, 'Acme Construction', 'https://user:password@www.sba.gov/directory?email=private@example.com#secret');
    assert.ok(label.length <= 128);
    assert.equal(subcontractOutboundTimelineLabel('subcontract_source_open', label), `Opened ${source}: Acme Construction → www.sba.gov`);
    assert.ok(!/password|private|secret|email=/.test(label));
  }
  const long = subcontractOutboundLabel('SBA directory', 'A|\n'.repeat(200), `https://${'a'.repeat(60)}.example.com/`);
  assert.ok(long.length <= 128);
  assert.ok(subcontractOutboundTimelineLabel('subcontract_source_open', long.slice(0, 128)));
});

test('invalid destinations and legacy/unrelated labels keep the existing timeline fallback', () => {
  for (const href of ['javascript:alert(1)', 'mailto:person@example.com', '/relative', 'invalid']) {
    assert.equal(subcontractOutboundLabel('SBA SUBNet', 'Notices', href), null);
  }
  for (const label of [null, 'old-notice-id', 'outbound|Unknown|Acme|sba.gov', 'outbound|SBA SUBNet||sba.gov']) {
    assert.equal(subcontractOutboundTimelineLabel('subcontract_source_open', label), null);
  }
  const label = subcontractOutboundLabel('SBA SUBNet', 'Notices', 'https://sba.gov/');
  assert.equal(subcontractOutboundTimelineLabel('signup_success', label), null);
});

test('every external subcontract anchor has a click handler, including all fallbacks', () => {
  const page = readFileSync(new URL('../src/routes/subcontracts.tsx', import.meta.url), 'utf8');
  const ast = parse(page, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  let count = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && node.name.name === 'a') {
      const attrs = node.attributes;
      if (attrs.some(a => a.name?.name === 'target' && a.value?.value === '_blank')) {
        count++;
        assert.ok(attrs.some(a => a.name?.name === 'onClick'), `Untracked external anchor at line ${node.loc.start.line}`);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.equal(count, 9);
});
