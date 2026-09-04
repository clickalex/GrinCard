/**
 * The three-tier access rules (§3.2, §6.2) and the profile schema (§5.1).
 * These are the rules that decide whether a stranger sees a WhatsApp number,
 * so they get tested exhaustively.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const A = require('../lib/access.js');

const T0 = Date.parse('2026-09-04T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const PROFILE = {
  username: 'rahul123',
  display_name: 'Rahul Kumar',
  designation: 'Freelance Illustrator',
  links: [
    { id: 'lnk_1', label: 'Instagram', url: 'https://instagram.com/rahul_art', visibility: 'public', order: 1 },
    { id: 'lnk_2', label: 'Portfolio', url: 'https://behance.net/rahulkumar', visibility: 'public', order: 2 },
    { id: 'lnk_3', label: 'Pricing List', url: 'https://docs.example.com/pricing', visibility: 'followers_only', order: 3 },
    { id: 'lnk_4', label: 'WhatsApp', url: 'https://wa.me/911234567890', visibility: 'followers_only', order: 4 }
  ],
  card_settings: { template_id: 'template-1', show_photo: true }
};

function registry(overrides) {
  return Object.assign({
    tokens: [
      {
        token_value: 'temp_abc123', profile_username: 'rahul123', target_link_id: 'lnk_3',
        created_at: iso(T0), expires_at: iso(T0 + 10 * 60 * 1000), max_uses: 1, current_uses: 0
      }
    ],
    followers: [
      { follower_id: 'user_ok', profile_username: 'rahul123', status: 'approved', approved_at: iso(T0) },
      { follower_id: 'user_wait', profile_username: 'rahul123', status: 'pending', requested_at: iso(T0) },
      { follower_id: 'user_gone', profile_username: 'rahul123', status: 'removed', requested_at: iso(T0) },
      { follower_id: 'user_other', profile_username: 'someoneelse', status: 'approved', approved_at: iso(T0) }
    ]
  }, overrides);
}

const ids = (r) => r.visibleLinks.map(l => l.id);

// ---------------------------------------------------------------------------
// Tier 1: public
// ---------------------------------------------------------------------------

test('a stranger sees only public links (Scenario A)', () => {
  const r = A.resolveAccess(PROFILE, {}, registry());
  assert.equal(r.tier, 'public');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2']);
  assert.equal(r.hiddenCount, 2);
});

test('public links are never hidden, even with a broken context', () => {
  for (const ctx of [undefined, null, {}, { token: '' }, { token: 'nonsense' }, { viewerId: null }]) {
    const r = A.resolveAccess(PROFILE, ctx, registry());
    assert.ok(r.visibleLinks.some(l => l.id === 'lnk_1'), JSON.stringify(ctx));
    assert.ok(!r.visibleLinks.some(A.isPrivate), 'a private link leaked for ' + JSON.stringify(ctx));
  }
});

test('an unrecognised token falls back to the public tier', () => {
  const r = A.resolveAccess(PROFILE, { token: 'temp_doesnotexist' }, registry());
  assert.equal(r.tier, 'public');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2']);
  assert.equal(r.token.reason, 'not_found');
});

// ---------------------------------------------------------------------------
// Tier 2: temporary tokens
// ---------------------------------------------------------------------------

test('a valid temporary token reveals exactly one private link (Scenario B)', () => {
  const r = A.resolveAccess(PROFILE, { token: 'temp_abc123' }, registry(), T0 + 1000);
  assert.equal(r.tier, 'temporary');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2', 'lnk_3']);
  assert.ok(r.token.valid);
});

test('a token for lnk_3 never reveals lnk_4', () => {
  const r = A.resolveAccess(PROFILE, { token: 'temp_abc123' }, registry(), T0 + 1000);
  assert.ok(!ids(r).includes('lnk_4'), 'the second private link must stay hidden');
});

test('an expired token falls back to public and says so', () => {
  const r = A.resolveAccess(PROFILE, { token: 'temp_abc123' }, registry(), T0 + 11 * 60 * 1000);
  assert.equal(r.tier, 'public');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2']);
  assert.equal(r.token.reason, 'expired');
  assert.ok(r.notices.some(n => n.kind === 'token-expired'));
});

test('expiry is inclusive at the boundary', () => {
  const atExpiry = A.resolveAccess(PROFILE, { token: 'temp_abc123' }, registry(), T0 + 10 * 60 * 1000);
  assert.equal(atExpiry.tier, 'temporary', 'exactly at expires_at is still valid');
  const after = A.resolveAccess(PROFILE, { token: 'temp_abc123' }, registry(), T0 + 10 * 60 * 1000 + 1);
  assert.equal(after.tier, 'public', 'one millisecond later it is expired');
});

test('an exhausted token (max_uses reached) falls back to public', () => {
  const reg = registry({
    tokens: [{
      token_value: 'temp_used', profile_username: 'rahul123', target_link_id: 'lnk_4',
      created_at: iso(T0), expires_at: iso(T0 + 60000), max_uses: 1, current_uses: 1
    }]
  });
  const r = A.resolveAccess(PROFILE, { token: 'temp_used' }, reg, T0);
  assert.equal(r.tier, 'public');
  assert.equal(r.token.reason, 'exhausted');
});

test('max_uses: 0 means unlimited uses', () => {
  const reg = registry({
    tokens: [{
      token_value: 'temp_open', profile_username: 'rahul123', target_link_id: 'lnk_4',
      created_at: iso(T0), expires_at: iso(T0 + 60000), max_uses: 0, current_uses: 500
    }]
  });
  const r = A.resolveAccess(PROFILE, { token: 'temp_open' }, reg, T0);
  assert.equal(r.tier, 'temporary');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2', 'lnk_4']);
});

test('a token issued for another profile is rejected', () => {
  const reg = registry({
    tokens: [{
      token_value: 'temp_other', profile_username: 'priya99', target_link_id: 'lnk_3',
      created_at: iso(T0), expires_at: iso(T0 + 60000), max_uses: 1, current_uses: 0
    }]
  });
  const r = A.resolveAccess(PROFILE, { token: 'temp_other' }, reg, T0);
  assert.equal(r.tier, 'public');
  assert.equal(r.token.reason, 'wrong_profile');
});

test('createToken produces unguessable, correctly-shaped tokens', () => {
  const t = A.createToken({ profileUsername: 'rahul123', linkId: 'lnk_3', durationSeconds: 600 });
  assert.match(t.token_value, /^temp_[A-Za-z2-9]{22}$/);
  assert.ok(t.token_value.length >= 16, 'spec requires >= 16 characters');
  assert.equal(t.profile_username, 'rahul123');
  assert.equal(t.target_link_id, 'lnk_3');
  assert.equal(t.max_uses, 1);
  assert.equal(t.current_uses, 0);
  assert.equal(Date.parse(t.expires_at) - Date.parse(t.created_at), 600000);
  // no ambiguous characters, and tokens are unique
  assert.ok(!/[0O1lI]/.test(t.token_value.slice(5)));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(A.createToken({ profileUsername: 'x', linkId: 'y' }).token_value);
  assert.equal(seen.size, 2000, '2000 tokens must all be distinct');
});

// ---------------------------------------------------------------------------
// Tier 3: approved followers
// ---------------------------------------------------------------------------

test('an approved follower sees every link (Scenario C)', () => {
  const r = A.resolveAccess(PROFILE, { viewerId: 'user_ok' }, registry());
  assert.equal(r.tier, 'follower');
  assert.deepEqual(ids(r), ['lnk_1', 'lnk_2', 'lnk_3', 'lnk_4']);
  assert.equal(r.hiddenCount, 0);
});

test('pending, rejected and removed followers are NOT approved', () => {
  for (const viewerId of ['user_wait', 'user_gone', 'user_unknown']) {
    const r = A.resolveAccess(PROFILE, { viewerId }, registry());
    assert.equal(r.tier, 'public', viewerId);
    assert.ok(!r.visibleLinks.some(A.isPrivate), viewerId + ' must not see private links');
  }
});

test('approval is per-profile: an approved follower of someone else sees nothing', () => {
  const r = A.resolveAccess(PROFILE, { viewerId: 'user_other' }, registry());
  assert.equal(r.tier, 'public');
});

test('an approved follower keeps full access even with a dead token in the URL', () => {
  const r = A.resolveAccess(PROFILE, { viewerId: 'user_ok', token: 'temp_expired' }, registry(),
    T0 + 99 * 60 * 1000);
  assert.equal(r.tier, 'follower');
  assert.equal(r.visibleLinks.length, 4);
});

test('createFollowerRequest defaults to pending and records timestamps', () => {
  const f = A.createFollowerRequest({
    profileUsername: 'rahul123', followerEmail: 'user@example.com', followerName: 'Priya'
  });
  assert.equal(f.status, 'pending');
  assert.equal(f.approved_at, null);
  assert.match(f.follower_id, /^user_[a-z2-9]{22}$/);
  assert.ok(Date.parse(f.requested_at));
  assert.deepEqual(A.FOLLOWER_STATUS, ['pending', 'approved', 'rejected', 'removed']);
});

// ---------------------------------------------------------------------------
// Ordering, validation, and the shipped data files
// ---------------------------------------------------------------------------

test('links are returned in `order`, whatever order they appear in the file', () => {
  const shuffled = { ...PROFILE, links: [PROFILE.links[3], PROFILE.links[0], PROFILE.links[2], PROFILE.links[1]] };
  assert.deepEqual(A.sortedLinks(shuffled).map(l => l.id), ['lnk_1', 'lnk_2', 'lnk_3', 'lnk_4']);
});

test('links with no order keep file order at the end', () => {
  const p = {
    username: 'x', display_name: 'X', links: [
      { id: 'a', url: 'https://a', visibility: 'public' },
      { id: 'b', url: 'https://b', visibility: 'public', order: 0 }
    ]
  };
  assert.deepEqual(A.sortedLinks(p).map(l => l.id), ['b', 'a']);
});

test('validateProfile accepts the spec example and normalises gaps', () => {
  const v = A.validateProfile(PROFILE);
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(v.errors, []);
  assert.equal(v.profile.card_settings.template_id, 'template-1');

  const patched = A.validateProfile({
    username: 'shop42', display_name: 'Shop',
    links: [
      { url: 'https://a.example', visibility: 'weird' },   // no id, bogus visibility
      { id: 'b', url: 'shop.example.com', visibility: 'public' } // no scheme
    ]
  });
  assert.ok(patched.ok, patched.errors.join('; '));
  assert.equal(patched.profile.links[0].id, 'lnk_1', 'missing ids are generated');
  assert.equal(patched.profile.links[0].visibility, 'public', 'unknown visibility becomes public');
  assert.equal(patched.profile.links[1].order, 2, 'missing order is filled in');
  assert.ok(patched.warnings.some(w => /unknown visibility/.test(w)));
  assert.ok(patched.warnings.some(w => /no scheme/.test(w)));

  // A link with no destination is a hard error, not something to paper over.
  const noUrl = A.validateProfile({
    username: 'shop42', display_name: 'Shop', links: [{ id: 'b', visibility: 'public' }]
  });
  assert.ok(!noUrl.ok);
  assert.ok(noUrl.errors.some(e => /missing url/.test(e)));
});

test('validateProfile rejects malformed profiles with useful messages', () => {
  assert.equal(A.validateProfile(null).ok, false);
  assert.equal(A.validateProfile({}).ok, false);
  const bad = A.validateProfile({ username: 'x', links: 'nope' });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some(e => /username/.test(e)));
  assert.ok(bad.errors.some(e => /links must be an array/.test(e)));

  const dupes = A.validateProfile({
    username: 'rahul123', display_name: 'R',
    links: [
      { id: 'a', url: 'https://a', visibility: 'public' },
      { id: 'a', url: 'https://b', visibility: 'public' }
    ]
  });
  assert.ok(!dupes.ok);
  assert.ok(dupes.errors.some(e => /duplicate link id/.test(e)));
});

test('validateRegistry drops malformed entries instead of crashing', () => {
  const reg = A.validateRegistry({
    tokens: [null, { token_value: 'ok', target_link_id: 'lnk_1' }, { token_value: 'nope' }],
    followers: [{ follower_id: 'u1', status: 'approved' }, { follower_id: 'u2', status: 'banana' }, null]
  });
  assert.equal(reg.tokens.length, 1);
  assert.equal(reg.followers.length, 1);
  assert.deepEqual(A.validateRegistry(null), { tokens: [], followers: [] });
});

test('validateRegistry strips unknown keys (callers must re-attach provenance)', () => {
  // loadRegistry() relies on this: it re-attaches _remoteTokens/_localTokens
  // after validating, so the dashboard can tell its own data from repo data.
  const reg = A.validateRegistry({
    tokens: [{ token_value: 'a', target_link_id: 'l' }],
    followers: [],
    _remoteTokens: [{ token_value: 'demo' }]
  });
  assert.deepEqual(Object.keys(reg), ['tokens', 'followers']);
  assert.equal(reg._remoteTokens, undefined);
});

test('pruneExpiredTokens removes only the past', () => {
  const reg = registry({
    tokens: [
      { token_value: 'live', target_link_id: 'a', expires_at: iso(T0 + 60000) },
      { token_value: 'dead', target_link_id: 'b', expires_at: iso(T0 - 60000) },
      { token_value: 'open', target_link_id: 'c' }
    ]
  });
  const kept = A.pruneExpiredTokens(reg, T0).map(t => t.token_value);
  assert.deepEqual(kept, ['live', 'open']);
});

test('the shipped profile-data files are valid and self-consistent', () => {
  const dir = path.join(__dirname, '..', 'profile-data');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 2, 'expected the demo profile and the template');
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (file === 'tokens.json') {
      // That one is a token/follower registry (§5.2, §5.3), not a profile (§5.1).
      const reg = A.validateRegistry(raw);
      assert.ok(reg.tokens.length >= 2, 'the demo registry should ship working tokens');
      assert.ok(reg.followers.length >= 1, 'and at least one approved follower');
      assert.deepEqual(A.FOLLOWER_STATUS, ['pending', 'approved', 'rejected', 'removed']);
      continue;
    }
    const v = A.validateProfile(raw);
    assert.ok(v.ok, `${file}: ${v.errors.join('; ')}`);
    if (file !== 'demo-template.json') {
      assert.equal(raw.username + '.json', file, `${file}: filename must match the username`);
      assert.ok(raw.profile_url, `${file}: needs profile_url so the QR has something to encode`);
    }

    // Every token target must exist, and every link id must be unique.
    const linkIds = new Set(raw.links.map(l => l.id));
    assert.equal(linkIds.size, raw.links.length, `${file}: duplicate link ids`);

    const tokensPath = path.join(dir, 'tokens.json');
    if (fs.existsSync(tokensPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      (tokens.tokens || []).forEach(t => {
        if (t.profile_username !== raw.username) return;
        assert.ok(linkIds.has(t.target_link_id),
          `${file}: token ${t.token_value} points at unknown link ${t.target_link_id}`);
      });
    }
  }
});

test('the demo token in the repo has a fixed expiry for reproducible demos', () => {
  const tokens = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'profile-data', 'tokens.json'), 'utf8'));
  const live = tokens.tokens.find(t => t.token_value === 'temp_demo_live');
  assert.ok(live, 'the demo needs a token that always works for screenshots');
  assert.equal(live.max_uses, 0, 'demo tokens must not be single-use');
  assert.equal(live.expires_at, null, 'demo tokens must not expire, or the docs go stale');
  const expired = tokens.tokens.find(t => t.token_value === 'temp_demo_expired');
  assert.ok(expired, 'the demo also needs an expired token to show the fallback');
  assert.equal(expired.expires_at, '2026-01-01T00:00:00Z',
    'fixed in the past so the demo keeps working years from now');
  assert.ok(Date.parse(expired.expires_at) < Date.now());
  assert.equal(expired.current_uses, expired.max_uses, 'and used up, for good measure');
});
