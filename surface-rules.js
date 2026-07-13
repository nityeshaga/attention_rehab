// Surface rules: the unit of blocking is a *surface* (a feed), not a whole site.
// This file runs in two worlds: injected as a content script (globalThis is the
// page's isolated world) and imported by the service worker via importScripts.
// It attaches everything to globalThis.AR so both can use it.

(function () {
  const X_HOSTS = ['x.com', 'twitter.com'];
  const YT_HOSTS = ['youtube.com'];

  function baseDomain(hostname) {
    hostname = (hostname || '').replace(/^www\./, '').toLowerCase();
    const parts = hostname.split('.');
    if (parts.length > 2) return parts.slice(-2).join('.');
    return hostname;
  }

  function normPath(p) {
    if (!p) return '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  }

  function blocked(surfaceId, canonicalPattern, feedSelectors) {
    return { blocked: true, surfaceId, canonicalPattern, feedSelectors: feedSelectors || [] };
  }
  function allowed(surfaceId, canonicalPattern) {
    return { blocked: false, surfaceId, canonicalPattern, feedSelectors: [] };
  }

  // X / Twitter --------------------------------------------------------------
  // Blocked: /home (For You + Following timeline), /explore, /i/trending, and
  // the logged-in root "/" (which is the home feed). Everything else — compose,
  // notifications, messages, search, a specific tweet, profiles, settings — is
  // allowed by default and needs no pass.
  function classifyX(pathname) {
    const p = normPath(pathname);
    if (p === '/' || p === '/home') {
      return blocked('x-home', '/home', ['[data-testid="primaryColumn"]']);
    }
    if (p === '/explore' || p.startsWith('/explore/')) {
      return blocked('x-explore', '/explore', ['[data-testid="primaryColumn"]']);
    }
    if (p === '/i/trending' || p.startsWith('/i/trending')) {
      return blocked('x-trending', '/i/trending', ['[data-testid="primaryColumn"]']);
    }
    return allowed('x-open', p);
  }

  // YouTube ------------------------------------------------------------------
  // Blocked: homepage feed ("/" and /feed/*), Shorts (/shorts/*).
  // Allowed: /watch, /results (search), channel pages, and /feed/subscriptions.
  function classifyYouTube(pathname) {
    const p = normPath(pathname);
    if (p === '/') {
      return blocked('yt-home', '/', ['ytd-browse[page-subtype="home"]', 'ytd-rich-grid-renderer']);
    }
    if (p === '/feed/subscriptions') {
      return allowed('yt-subscriptions', '/feed/subscriptions');
    }
    if (p === '/shorts' || p.startsWith('/shorts/')) {
      return blocked('yt-shorts', '/shorts', ['ytd-shorts', 'ytd-reel-video-renderer']);
    }
    if (p === '/feed' || p.startsWith('/feed/')) {
      return blocked('yt-feed', '/feed', ['ytd-browse']);
    }
    return allowed('yt-open', p);
  }

  // Generic user-added domain: whole-domain block, enforced in-page (overlay),
  // never by navigating the tab away.
  function classifyGeneric() {
    return blocked('domain', '/*', []);
  }

  function platformFor(hostname) {
    const base = baseDomain(hostname);
    if (X_HOSTS.includes(base)) return 'x';
    if (YT_HOSTS.includes(base)) return 'youtube';
    return 'generic';
  }

  function classify(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const hostname = u.hostname;
    const base = baseDomain(hostname);
    const platform = platformFor(hostname);
    let res;
    if (platform === 'x') res = classifyX(u.pathname);
    else if (platform === 'youtube') res = classifyYouTube(u.pathname);
    else res = classifyGeneric();
    return Object.assign({ platform, hostname, base, pathname: normPath(u.pathname) }, res);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function globMatch(pattern, path) {
    pattern = normPath(pattern);
    const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
    try { return new RegExp(rx).test(path); } catch (e) { return false; }
  }

  // Is the current URL inside the scope granted by a pass?
  function matchScope(scopeSurfaces, url) {
    if (!Array.isArray(scopeSurfaces) || scopeSurfaces.length === 0) return false;
    const cls = classify(url);
    if (!cls) return false;
    return scopeSurfaces.some(function (pat) {
      if (pat === cls.canonicalPattern) return true;
      return globMatch(pat, cls.pathname);
    });
  }

  // Human-readable vocabulary handed to the model when parsing an intent.
  const PLATFORM_VOCAB = {
    x: {
      blocked: ['/home (the For You and Following timeline)', '/explore', '/i/trending'],
      allowed: ['/compose/*', '/notifications', '/messages', '/search', '/<user>/status/<id> (a single tweet)', 'profile pages', '/settings']
    },
    youtube: {
      blocked: ['/ (homepage feed)', '/feed/* (except /feed/subscriptions)', '/shorts/*'],
      allowed: ['/watch', '/results (search)', 'channel pages', '/feed/subscriptions']
    },
    generic: {
      blocked: ['the whole site'],
      allowed: []
    }
  };

  globalThis.AR = {
    baseDomain: baseDomain,
    normPath: normPath,
    classify: classify,
    matchScope: matchScope,
    globMatch: globMatch,
    platformFor: platformFor,
    PLATFORM_VOCAB: PLATFORM_VOCAB,
    STATIC_HOSTS: ['x.com', 'twitter.com', 'youtube.com']
  };
})();
