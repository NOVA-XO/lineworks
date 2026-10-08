/* node --test tools/test-profile-model.mjs — профайлын өгөгдлийн тест (хамааралгүй). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileModel, licenceState, daysLeftOn, maskToken } from '../assets/profile-model.js';

const TODAY = '2026-10-08';
const A = 'C557415F31D2A2E3';
const B = '0000111122223333';
const C = 'AAAABBBBCCCCDDDD';
const profile = { full_name: 'Бат', organization: 'ABC ХХК', role: 'user', created_at: '2026-10-07T03:00:00Z' };
const lic = (o) => ({
  id: 1, no: 'ZLW-AAAA-BBBB-CCCC-DDDD', machine_id: A, edition: 'subscription', status: 'active',
  valid_from: '2026-10-01', valid_until: '2027-09-30', license_text: `-----BEGIN ZENITH LINEWORKS LICENSE-----\nZLW1.${'x'.repeat(600)}.sig12345\n-----END ZENITH LINEWORKS LICENSE-----`,
  ...o,
});

test('days left counts the last day, like the plug-in', () => {
  assert.equal(daysLeftOn('2026-10-08', TODAY), 1);
  assert.equal(daysLeftOn('2026-10-07', TODAY), 0);
  assert.equal(daysLeftOn('2026-11-06', TODAY), 30);
  assert.equal(daysLeftOn('9999-12-31', TODAY), Infinity);
});

test('state: revoked beats dates; 30 days or fewer is expiring', () => {
  assert.equal(licenceState(lic({ status: 'revoked' }), TODAY), 'revoked');
  assert.equal(licenceState(lic({ valid_until: '2026-10-07' }), TODAY), 'expired');
  assert.equal(licenceState(lic({ valid_until: '2026-11-06' }), TODAY), 'expiring');
  assert.equal(licenceState(lic({ valid_until: '2026-11-07' }), TODAY), 'active');
  assert.equal(licenceState(lic({ valid_from: '2026-10-09' }), TODAY), 'future');
  assert.equal(licenceState(lic({ edition: 'prime', valid_until: '9999-12-31' }), TODAY), 'active');
});

test('the token is never shown whole', () => {
  const masked = maskToken(lic().license_text);
  assert.ok(masked.startsWith('ZLW1.xxxxxxx'));
  assert.ok(masked.endsWith('sig12345'));
  assert.ok(masked.length < 40);
  assert.ok(!masked.includes('BEGIN'));
});

test('primary licence: a working one over a later revoked one; perpetual over dated', () => {
  const m = profileModel({
    profile, email: 'bat@abc.mn', today: TODAY, requests: [],
    licences: [
      lic({ id: 1, valid_until: '2027-01-01' }),
      lic({ id: 2, valid_until: '2028-01-01', status: 'revoked' }),
      lic({ id: 3, valid_until: '2026-10-01', valid_from: '2026-09-01' }),
    ],
  });
  assert.equal(m.primary.id, 1);
  assert.equal(m.activeCount, 1);

  const p = profileModel({
    profile, email: '', today: TODAY, requests: [],
    licences: [lic({ id: 1, valid_until: '2027-01-01' }), lic({ id: 2, edition: 'prime', valid_until: '9999-12-31' })],
  });
  assert.equal(p.primary.id, 2);
  assert.equal(p.primary.perpetual, true);
  assert.equal(p.primary.remaining, 1);
});

test('machines: from licences and requests, current first, pending without licence', () => {
  const m = profileModel({
    profile, email: '', today: TODAY, currentMachine: '0000-1111-2222-3333',
    licences: [
      lic({ id: 1, machine_id: A }),
      lic({ id: 2, machine_id: A, valid_until: '2026-09-01', valid_from: '2025-09-01' }),
    ],
    requests: [
      { machine_id: B, status: 'pending', created_at: '2026-10-08T01:00:00Z' },
      { machine_id: C, status: 'rejected', created_at: '2026-10-02T01:00:00Z' },
    ],
  });
  assert.deepEqual(m.machines.map((x) => x.machine_id), [B, A, C]);
  assert.equal(m.machines[0].isCurrent, true);
  assert.equal(m.machines[0].state, 'pending');
  assert.equal(m.machines[1].licences, 2);
  assert.equal(m.machines[1].licence.id, 1);
  assert.equal(m.machines[1].state, 'active');
  assert.equal(m.machines[2].state, 'none');
  assert.equal(m.pendingCount, 1);
});

test('no licences, no requests: empty but complete profile', () => {
  const m = profileModel({ profile, email: 'bat@abc.mn', today: TODAY, licences: [], requests: [] });
  assert.equal(m.primary, null);
  assert.deepEqual(m.machines, []);
  assert.equal(m.complete, true);
  assert.equal(m.since, '2026-10-07');
  assert.equal(profileModel({ profile: { ...profile, organization: ' ' }, email: '', today: TODAY, licences: [], requests: [] }).complete, false);
});
