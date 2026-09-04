/*!
 * access.js — the three-tier visibility rules from the spec (§3.2, §6.2).
 *
 * Part of "QR Link Card" (open-qr-link-card). MIT licensed. No dependencies.
 *
 * This module is the single source of truth for "which links may this visitor
 * see?". It is deliberately pure: it takes data in and returns data out, with no
 * DOM access, so the same rules run on the public page, in the dashboard preview
 * and (in V2) on the server.
 *
 * SECURITY NOTE — read this before you trust V1 with real private links.
 * In V1 the profile JSON is fetched by the browser, which means "followers only"
 * URLs are already on the visitor's device even though they are not rendered.
 * V1 demonstrates the UX and the logic; it is NOT an access control system.
 * Real enforcement requires the server-side endpoint described in
 * docs/ARCHITECTURE.md (§"Why V2 is not optional for private data").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AccessRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIER = { PUBLIC: 'public', TEMPORARY: 'temporary', FOLLOWER: 'follower' };
  var VISIBILITY = { PUBLIC: 'public', FOLLOWERS_ONLY: 'followers_only' };

  // Free-tier limits from §14. The open-source core never enforces a paywall —
  // these exist so a hosted instance can be configured with the same numbers.
  var LIMITS = {
    maxPublicLinks: 5,
    maxActiveTokens: 1,
    tokenDurationsSeconds: {
      '10m': 10 * 60,
      '1h': 60 * 60,
      '24h': 24 * 60 * 60,
      '7d': 7 * 24 * 60 * 60
    }
  };

  var TOKEN_PREFIX = 'temp_';

  /**
   * How each token duration is described in the UI. The picker in the dashboard
   * is generated from LIMITS.tokenDurationsSeconds, so adding a duration there
   * adds it everywhere — a label here is optional but makes it read better than
   * "604800 seconds".
   */
  var DURATION_LABELS = {
    600: '10 minutes',
    3600: '1 hour',
    86400: '24 hours',
    604800: '7 days',
    2592000: '30 days'
  };

  /** Available durations as [{ key, seconds, label }], shortest first. */
  function durationOptions() {
    var keys = LIMITS.tokenDurationsSeconds || {};
    return Object.keys(keys)
      .map(function (key) { return { key: key, seconds: keys[key] }; })
      .sort(function (a, b) { return a.seconds - b.seconds; })
      .map(function (d) {
        return {
          key: d.key,
          seconds: d.seconds,
          label: DURATION_LABELS[d.seconds] || humanDuration(d.seconds)
        };
      });
  }

  /** "604800 seconds" -> "7 days", for durations nobody labelled. */
  function humanDuration(seconds) {
    var units = [
      [86400, 'day'], [3600, 'hour'], [60, 'minute']
    ];
    for (var i = 0; i < units.length; i++) {
      var size = units[i][0], name = units[i][1];
      if (seconds % size === 0 && seconds >= size) {
        var n = seconds / size;
        return n + ' ' + name + (n === 1 ? '' : 's');
      }
    }
    return seconds + ' seconds';
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /** Parse an ISO-8601 timestamp into ms, or null if unusable. */
  function parseTime(value) {
    if (!value) return null;
    var t = Date.parse(value);
    return isNaN(t) ? null : t;
  }

  function now() { return Date.now(); }

  /** Cryptographically-random token where available, Math.random otherwise. */
  function randomToken(prefix) {
    var body = '';
    var alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/l/I
    var bytes = null;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      bytes = new Uint8Array(22);
      crypto.getRandomValues(bytes);
    }
    for (var i = 0; i < 22; i++) {
      var n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
      body += alphabet[n % alphabet.length];
    }
    // prefix === undefined means "use the token prefix"; prefix === '' means none.
    return (prefix === undefined ? TOKEN_PREFIX : prefix) + body;
  }

  // ---------------------------------------------------------------------------
  // Tokens (§5.2)
  // ---------------------------------------------------------------------------

  /**
   * Create a temporary-access token for one specific link.
   * @param {object} opts  { profileUsername, linkId, durationSeconds, maxUses }
   */
  function createToken(opts) {
    var created = now();
    var ttl = (opts && opts.durationSeconds) || LIMITS.tokenDurationsSeconds['10m'];
    return {
      token_id: 'tok_' + new Date(created).toISOString().slice(0, 10).replace(/-/g, '') + '_' +
        String(created).slice(-4),
      token_value: randomToken(),
      profile_username: opts.profileUsername,
      target_link_id: opts.linkId,
      created_at: new Date(created).toISOString(),
      expires_at: new Date(created + ttl * 1000).toISOString(),
      max_uses: (opts && opts.maxUses) || 1,
      current_uses: 0
    };
  }

  /**
   * Evaluate a token against the registry. Returns
   * { valid, linkId, reason, msLeft } where reason is one of:
   *   'ok' | 'not_found' | 'expired' | 'exhausted' | 'wrong_profile' | 'malformed'
   */
  function evaluateToken(tokenValue, profileUsername, registry, atTime) {
    var at = atTime || now();
    if (!tokenValue || typeof tokenValue !== 'string') {
      return { valid: false, reason: 'malformed' };
    }
    var tokens = (registry && registry.tokens) || [];
    var match = null;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].token_value === tokenValue) { match = tokens[i]; break; }
    }
    if (!match) return { valid: false, tokenValue: tokenValue, reason: 'not_found' };

    if (match.profile_username && match.profile_username !== profileUsername) {
      return { valid: false, tokenValue: tokenValue, reason: 'wrong_profile' };
    }
    // expires_at === null means "never expires" — useful for a demo, and for a
    // self-hoster who wants a long-lived token. parseTime() also returns null
    // for an unparseable value, which we treat the same way rather than failing
    // closed on a typo: the worst case is a public link being shown.
    var expires = parseTime(match.expires_at);
    if (match.expires_at && expires !== null && at > expires) {
      return { valid: false, tokenValue: tokenValue, reason: 'expired', msLeft: expires - at };
    }
    var maxUses = match.max_uses == null ? 1 : match.max_uses;
    var uses = match.current_uses || 0;
    if (maxUses > 0 && uses >= maxUses) {
      return { valid: false, tokenValue: tokenValue, reason: 'exhausted' };
    }
    return {
      valid: true,
      tokenValue: tokenValue,
      linkId: match.target_link_id,
      reason: 'ok',
      expiresAt: match.expires_at || null,
      msLeft: expires === null ? null : expires - at
    };
  }

  // ---------------------------------------------------------------------------
  // Followers (§5.3)
  // ---------------------------------------------------------------------------

  var FOLLOWER_STATUS = ['pending', 'approved', 'rejected', 'removed'];

  function createFollowerRequest(opts) {
    var requested = now();
    return {
      follower_id: opts.followerId || 'user_' + randomToken('').toLowerCase(),
      follower_email: opts.followerEmail || null,
      follower_name: opts.followerName || null,
      profile_username: opts.profileUsername,
      status: 'pending',
      requested_at: new Date(requested).toISOString(),
      approved_at: null
    };
  }

  function findFollower(registry, profileUsername, followerId) {
    var list = (registry && registry.followers) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].profile_username === profileUsername && list[i].follower_id === followerId) {
        return list[i];
      }
    }
    return null;
  }

  function isApprovedFollower(registry, profileUsername, followerId) {
    var f = findFollower(registry, profileUsername, followerId);
    return !!(f && f.status === 'approved');
  }

  // ---------------------------------------------------------------------------
  // The tier resolution — the heart of §6.2
  // ---------------------------------------------------------------------------

  /**
   * Decide which tier a visitor belongs to, then which links they may see.
   *
   * Order matters and mirrors the server pseudo-code exactly:
   *   1. authenticated + approved  -> follower tier (everything)
   *   2. valid temporary token     -> temporary tier (public + the token's link)
   *   3. anything else             -> public tier
   *
   * A valid token never downgrades an approved follower, and an expired token
   * silently falls back to the public tier (the printed URL keeps working).
   */
  function resolveAccess(profile, context, registry, atTime) {
    context = context || {};
    var at = atTime || now();
    var username = profile && profile.username;
    var result = {
      tier: TIER.PUBLIC,
      token: null,
      follower: null,
      visibleLinks: [],
      hiddenCount: 0,
      notices: []
    };

    // 1. Permanent (approved follower)
    if (context.viewerId && isApprovedFollower(registry, username, context.viewerId)) {
      var f = findFollower(registry, username, context.viewerId);
      result.tier = TIER.FOLLOWER;
      result.follower = f;
    }

    // 2. Temporary token
    if (context.token) {
      var verdict = evaluateToken(context.token, username, registry, at);
      result.token = verdict;
      if (verdict.valid && result.tier !== TIER.FOLLOWER) {
        result.tier = TIER.TEMPORARY;
      } else if (!verdict.valid && verdict.reason !== 'not_found' && verdict.reason !== 'malformed') {
        result.notices.push({
          kind: 'token-' + verdict.reason,
          message: verdict.reason === 'expired'
            ? 'This temporary link has expired. Showing public links only.'
            : 'This temporary link can no longer be used. Showing public links only.'
        });
      }
    }

    var all = sortedLinks(profile);
    var allowed = all.filter(function (link) {
      return isLinkVisible(link, result.tier, result.token);
    });

    result.visibleLinks = allowed;
    result.hiddenCount = all.length - allowed.length;
    return result;
  }

  /**
   * A single link's visibility against a resolved tier.
   *
   * Fails closed: only an explicit 'public' is public. Anything else — followers_only, a
   * typo, a value in the wrong case, or a missing field — is treated as followers_only.
   *
   * The asymmetry decides this. Failing closed costs a link that does not appear, which the
   * owner sees on their own page immediately and can fix. Failing open publishes something
   * they meant to hide to every stranger who scans their card, permanently — and the whole
   * premise of this project is that a printed URL cannot be taken back.
   */
  function isLinkVisible(link, tier, tokenVerdict) {
    if (!link) return false;
    if (link.visibility === VISIBILITY.PUBLIC) return true;
    if (tier === TIER.FOLLOWER) return true;
    if (tier === TIER.TEMPORARY && tokenVerdict && tokenVerdict.valid) {
      return tokenVerdict.linkId === link.id;
    }
    return false;
  }

  /** Links ordered by the explicit `order` field, falling back to array order. */
  function sortedLinks(profile) {
    var links = ((profile && profile.links) || []).slice();
    return links.sort(function (a, b) {
      var ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
      var bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
      return ao - bo;
    });
  }

  /** The complement of isLinkVisible at the public tier — same rule, so the two agree. */
  function isPrivate(link) { return !!link && link.visibility !== VISIBILITY.PUBLIC; }

  // ---------------------------------------------------------------------------
  // Profile validation — keeps hand-edited JSON honest
  // ---------------------------------------------------------------------------

  /**
   * Validate a profile object. Returns { ok, profile, errors, warnings } and
   * normalises anything fixable (link order, ids, unknown visibility values).
   */
  function validateProfile(raw) {
    var errors = [], warnings = [];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, errors: ['profile is not an object'], warnings: warnings };
    }
    var p = JSON.parse(JSON.stringify(raw)); // deep clone

    if (!p.username || !/^[a-z0-9_.-]{3,32}$/i.test(p.username)) {
      errors.push('username must be 3-32 characters of a-z, 0-9, dot, dash or underscore');
    }
    if (!p.display_name) { errors.push('display_name is required'); p.display_name = p.username || ''; }
    if (p.designation == null) p.designation = '';
    if (!Array.isArray(p.links)) { errors.push('links must be an array'); p.links = []; }

    var seenIds = Object.create(null);
    var publicCount = 0;
    p.links.forEach(function (link, i) {
      if (!link || typeof link !== 'object') { errors.push('links[' + i + '] is not an object'); return; }
      if (!link.id) { link.id = 'lnk_' + (i + 1); warnings.push('links[' + i + ']: generated missing id'); }
      if (seenIds[link.id]) { errors.push('duplicate link id: ' + link.id); }
      seenIds[link.id] = true;
      if (!link.label) { link.label = link.url || 'Link'; warnings.push(link.id + ': missing label'); }
      if (!link.url) errors.push(link.id + ': missing url');
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(link.url)) {
        warnings.push(link.id + ': url has no scheme, browsers will treat it as relative');
      }
      if (link.visibility !== VISIBILITY.PUBLIC && link.visibility !== VISIBILITY.FOLLOWERS_ONLY) {
        // Normalise to the restrictive value, not the permissive one: an unrecognised
        // word here is far more likely to be a misspelling of followers_only than of
        // public, and guessing wrong in the other direction publishes a private link.
        warnings.push(link.id + ': unknown visibility "' + link.visibility +
          '", defaulting to followers_only (hidden until approved or tokened) — ' +
          'use "public" or "followers_only"');
        link.visibility = VISIBILITY.FOLLOWERS_ONLY;
      }
      if (typeof link.order !== 'number') link.order = i + 1;
      if (link.visibility === VISIBILITY.PUBLIC) publicCount++;
    });

    if (publicCount > LIMITS.maxPublicLinks) {
      warnings.push(publicCount + ' public links exceed the free-tier limit of ' +
        LIMITS.maxPublicLinks + ' (self-hosted instances may ignore this)');
    }
    if (!p.card_settings || typeof p.card_settings !== 'object') p.card_settings = {};
    if (!p.card_settings.template_id) p.card_settings.template_id = 'template-1';
    if (!p.created_at) p.created_at = new Date().toISOString();

    return { ok: errors.length === 0, profile: p, errors: errors, warnings: warnings };
  }

  /** Validate a tokens registry file ({ tokens: [], followers: [] }). */
  function validateRegistry(raw) {
    var out = { tokens: [], followers: [] };
    if (!raw || typeof raw !== 'object') return out;
    if (Array.isArray(raw.tokens)) {
      out.tokens = raw.tokens.filter(function (t) {
        return t && typeof t.token_value === 'string' && t.target_link_id;
      });
    }
    if (Array.isArray(raw.followers)) {
      out.followers = raw.followers.filter(function (f) {
        return f && f.follower_id && FOLLOWER_STATUS.indexOf(f.status) >= 0;
      });
    }
    return out;
  }

  /** Prune tokens whose expiry is in the past (housekeeping for owners). */
  function pruneExpiredTokens(registry, atTime) {
    var at = atTime || now();
    return (registry.tokens || []).filter(function (t) {
      var exp = parseTime(t.expires_at);
      return exp === null || exp > at;
    });
  }

  return {
    TIER: TIER,
    VISIBILITY: VISIBILITY,
    LIMITS: LIMITS,
    FOLLOWER_STATUS: FOLLOWER_STATUS,
    TOKEN_PREFIX: TOKEN_PREFIX,
    DURATION_LABELS: DURATION_LABELS,
    durationOptions: durationOptions,
    humanDuration: humanDuration,
    createToken: createToken,
    evaluateToken: evaluateToken,
    createFollowerRequest: createFollowerRequest,
    findFollower: findFollower,
    isApprovedFollower: isApprovedFollower,
    resolveAccess: resolveAccess,
    isLinkVisible: isLinkVisible,
    isPrivate: isPrivate,
    sortedLinks: sortedLinks,
    validateProfile: validateProfile,
    validateRegistry: validateRegistry,
    pruneExpiredTokens: pruneExpiredTokens,
    randomToken: randomToken,
    parseTime: parseTime
  };
});
