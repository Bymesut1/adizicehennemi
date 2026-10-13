// ============================================================
//  abidizicehennemi — Nuvio scraper (dizicehennemi.click)              v1.0.4
//  Akış: TMDB -> film/dizi sayfası (başlıktan adres) -> oynatıcı (pilavyerplay) -> m3u8 (+ altyazı)
//  Film:  /film/<slug>      Dizi: /dizi/<slug>/sezon-S/bolum-E
// ============================================================

var AYAR = {
  SITE: 'https://dizicehennemi.click',
  EKLENTI_ADI: 'abidizicehennemi',
  DEBUG_MODU: true,      // true: akış çıkmazsa nedenini "DEBUG" satırlarıyla gösterir
  DOGRULA: true,         // m3u8'i oynatmadan önce kontrol et
  ALTYAZI_YUKLE: true,   // WebVTT'yi SRT'ye çevirip geçici barındırıcıya yükle (Nuvio SRT okuyor)
  ALTYAZI_SAYISI: 2,
  ISTEK_SURESI: 8000,
  GENEL_SURE: 25000
};

var TMDB_KEY = '000316508321ce461cf81e7c6815eec7';
var PROVIDER_ID = 'abidizicehennemi';
var UA = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var dbg = [];

function note(m) { dbg.push(String(m).slice(0, 110)); }

// ---------------- Yardımcılar ----------------

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

function hostShort(u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, 'w.').slice(0, 24); }

function rawGet(url, headers, label, tmo) {
  tmo = tmo || AYAR.ISTEK_SURESI;
  return withTimeout(fetch(url, { headers: headers }), tmo).then(function (res) {
    return withTimeout(res.text(), tmo).then(
      function (t) { return { status: res.status, ok: res.ok, text: t || '', url: res.url || url }; },
      function () { return { status: res.status, ok: false, text: '', url: res.url || url }; }
    );
  }).catch(function (e) {
    return { status: 0, ok: false, text: '', err: (e && e.message) || 'hata', url: url };
  }).then(function (r) {
    if (label) note(label + ' ' + (r.status || r.err || '?') + '/' + r.text.length);
    return r;
  });
}

function getJson(url) {
  return withTimeout(fetch(url), 10000).then(function (res) { return res.json(); });
}

function pathOf(u) { return String(u || '').replace(/^https?:\/\/[^\/]+/i, '') || '/'; }

function decodeHtml(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

var TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
function asciiLower(s) {
  return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
    .replace(/[çğıöşüâîû]/g, function (c) { return TR_MAP[c]; });
}
function norm(s) { return asciiLower(s).replace(/[^a-z0-9]/g, ''); }
function slugify(s) { return asciiLower(s).replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function uniq(list) {
  var out = [];
  list.forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); });
  return out;
}

function waitWithin(promises, ms) {
  return new Promise(function (resolve) {
    var left = promises.length, done = false;
    if (!left) { resolve(); return; }
    var t = setTimeout(function () { if (!done) { done = true; resolve(); } }, ms);
    promises.forEach(function (p) {
      p.then(function () {}, function () {}).then(function () {
        left--;
        if (left === 0 && !done) { done = true; clearTimeout(t); resolve(); }
      });
    });
  });
}

// ---------------- Site araması ----------------
function utf8Bytes(str) {
  var out = [], i, c, d;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) { d = str.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536) out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return out;
}
function b64enc(str) {
  var b = utf8Bytes(str), o = '', i, n;
  for (i = 0; i < b.length; i += 3) {
    n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    o += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + (i + 1 < b.length ? B64.charAt((n >> 6) & 63) : '=') + (i + 2 < b.length ? B64.charAt(n & 63) : '=');
  }
  return o;
}
function toVtt(t) {
  t = String(t || '').replace(/^\uFEFF/, '');
  if (/^\s*WEBVTT/.test(t)) return t;
  return 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
}
function vttToSrt(t) {
  var blocks = String(t || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\n+/), out = [], n = 1;
  blocks.forEach(function (b) {
    if (/^\s*(WEBVTT|NOTE|STYLE)/.test(b)) return;
    var lines = b.split('\n').filter(function (l) { return l !== ''; }), ti = -1, i;
    for (i = 0; i < lines.length; i++) if (/-->/.test(lines[i])) { ti = i; break; }
    if (ti < 0) return;
    var time = lines[ti].replace(/(\d+:\d\d:\d\d)\.(\d{3})/g, '$1,$2').replace(/(^|\D)(\d\d:\d\d)\.(\d{3})/g, '$100:$2,$3').replace(/\s+(align|position|line|size|vertical):.*$/, '');
    out.push((n++) + '\n' + time + '\n' + lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, ''));
  });
  return out.join('\n\n') + '\n';
}
function isSubText(r) { return r.status === 200 && /^\s*(?:\uFEFF)?\s*(WEBVTT|\d+\s*\r?\n\s*\d\d:\d\d)/.test(r.text || ''); }


function isSrtText(r) { return (r.status === 200) && /^\s*(?:\uFEFF)?\s*\d+\s*\r?\n\s*\d\d:\d\d:\d\d,\d{3}\s*-->/.test(r.text || ''); }

// Metni geçici bir barındırıcıya yükle, geri okunabilen http adresini ver (olmazsa '')
function uploadText(text, name) {
  var hdr = { 'User-Agent': UA };
  function check(u) { return rawGet(u, hdr, '', 6000).then(function (r) { return isSrtText(r) ? u : ''; }); }
  function viaPasteRs() {
    return withTimeout(fetch('https://paste.rs', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': UA }, body: text }), 9000)
      .then(function (res) { return res.text(); })
      .then(function (t) {
        var u = String(t || '').trim().split(/\s/)[0];
        if (!/^https?:\/\/paste\.rs\/[\w-]+$/.test(u)) return '';
        return check(u + '.srt').then(function (ok) { return ok || check(u); });
      }).catch(function () { return ''; });
  }
  function viaDpaste() {
    var form = 'content=' + encodeURIComponent(text) + '&syntax=text&expiry_days=3';
    return withTimeout(fetch('https://dpaste.com/api/v2/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: form }), 9000)
      .then(function (res) { return res.text(); })
      .then(function (t) {
        var u = String(t || '').trim().split(/\s/)[0];
        if (!/^https?:\/\/dpaste\.com\/\w+/.test(u)) return '';
        return check(u + '.txt');
      }).catch(function () { return ''; });
  }
  return viaPasteRs().then(function (u) { return u || viaDpaste(); });
}


// ---------------- Site yardımcıları ----------------

function abs(u) {
  u = decodeHtml(String(u || '')).replace(/\\\//g, '/');
  if (/^https?:\/\//i.test(u)) return u.replace(/^https?:\/\/(?:www\.)?dizicehennemi\.[a-z]+/i, AYAR.SITE);
  if (u.indexOf('//') === 0) return 'https:' + u;
  return AYAR.SITE + (u.charAt(0) === '/' ? '' : '/') + u;
}
function originOf(u) { var m = String(u || '').match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : AYAR.SITE; }
function clean(s) {
  return String(s || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&#x2F;/g, '/');
}
function siteGet(path, ref, label) {
  var url = /^https?:/i.test(path) ? path : AYAR.SITE + path;
  return rawGet(url, { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7', 'Referer': ref || (AYAR.SITE + '/') }, label);
}
function debugStream(msg) {
  if (!AYAR.DEBUG_MODU) return [];
  return [msg].concat(dbg.slice(0, 40)).map(function (r) {
    return { name: 'DEBUG ' + r, title: 'DEBUG ' + r, url: 'https://debug.invalid/', quality: 'Auto', provider: PROVIDER_ID };
  });
}
function isPlaylist(r) { return (r.status === 200 || r.status === 206) && /^\s*#EXTM3U/.test(r.text || ''); }

// ---------------- Sayfa bulma ----------------

function pageOkRes(r) { return r && r.status === 200 && /DiziCehennemi/i.test(r.text || '') && !/<title>[^<]*(404|bulunamad)/i.test(r.text || ''); }

function findPage(titles, year, isTv, season, episode) {
  var slugs = [];
  titles.forEach(function (t) {
    var s = slugify(t);
    if (!s) return;
    slugs.push(s);
    if (year) slugs.push(s + '-' + year);
  });
  slugs = uniq(slugs).slice(0, 8);
  var paths = slugs.map(function (s) {
    return isTv ? '/dizi/' + s + '/sezon-' + season + '/bolum-' + episode : '/film/' + s;
  });
  return Promise.all(paths.map(function (p) {
    return siteGet(p, null, 'P').then(function (r) { return { p: p, r: r, ok: pageOkRes(r) }; });
  })).then(function (list) {
    for (var i = 0; i < list.length; i++) if (list[i].ok) { note('sayfa ' + list[i].p); return { url: AYAR.SITE + list[i].p, html: list[i].r.text }; }
    note('sayfa yok: ' + paths.slice(0, 2).join(' '));
    return null;
  });
}

// ---------------- Oynatıcıyı bul ----------------

var ASSET = /\.(jpe?g|png|webp|gif|css|js|svg|ico|woff2?)(\?|$)/i;

function playerPages(html) {
  var out = [], m, t = clean(html);
  var re = /<iframe[^>]*?\s(?:data-src|src)=["']([^"']+)["']/gi;
  while ((m = re.exec(html))) out.push(abs(m[1]));
  var re2 = /\sdata-(?:url|embed|video|player|src)=["']((?:https?:)?\/\/[^"']+|\/[^"']+)["']/gi;
  while ((m = re2.exec(html))) out.push(abs(m[1]));
  var re3 = /https?:\/\/[^"'\s<>\\]*(?:player|embed|pilavyer)[^"'\s<>\\]*/gi;
  while ((m = re3.exec(t))) out.push(m[0]);
  return uniq(out).filter(function (u) { return !ASSET.test(u); }).slice(0, 6);
}

function innerFrames(html) {
  var out = [], m, re = /<iframe[^>]*?\s(?:data-src|src)=["']([^"']+)["']/gi;
  while ((m = re.exec(html))) out.push(abs(m[1]));
  return out.filter(function (u) { return !ASSET.test(u); }).slice(0, 3);
}

function streamsIn(blobs) {
  var out = [];
  blobs.forEach(function (b) {
    (b.match(/https?:\/\/[^"'\s<>\\)]+/g) || []).forEach(function (u) {
      u = u.replace(/[,;]+$/, '');
      if (/stream\.php|\.m3u8|\.mp4/i.test(u) && !/sub\.php/i.test(u)) out.push(u);
    });
  });
  return uniq(out);
}

function subsIn(blobs) {
  var out = [];
  blobs.forEach(function (b) {
    (b.match(/https?:\/\/[^"'\s<>\\)]+(?:sub\.php|\.vtt|\.srt)[^"'\s<>\\)]*/gi) || []).forEach(function (u) { out.push(u.replace(/[,;]+$/, '')); });
  });
  return uniq(out);
}

function verifyUrl(u, sets) {
  if (!AYAR.DOGRULA || /\.mp4(\?|$)/i.test(u)) return Promise.resolve({ ok: true, headers: sets[0] });
  function next(i) {
    if (i >= sets.length) return Promise.resolve({ ok: false, headers: sets[0] });
    return rawGet(u, sets[i], '', 7000).then(function (r) {
      if (isPlaylist(r)) return { ok: true, headers: sets[i] };
      note('dogrula h' + i + ' ' + (r.status || r.err || '?'));
      return next(i + 1);
    });
  }
  return next(0);
}

// WebVTT -> SRT -> geçici barındırıcı (Nuvio SRT bekliyor)
function prepSub(url, idx, pageUrl) {
  var sets = [
    { 'User-Agent': UA, 'Referer': AYAR.SITE + '/', 'Origin': AYAR.SITE },
    { 'User-Agent': UA, 'Referer': pageUrl },
    { 'User-Agent': UA }
  ];
  function next(i) {
    if (i >= sets.length) return Promise.resolve(null);
    return rawGet(url, sets[i], '', 7000).then(function (r) { return isSubText(r) ? r.text : next(i + 1); });
  }
  var lang3 = idx === 0 ? 'tur' : 'und', lab = idx === 0 ? 'Türkçe' : 'Altyazı ' + (idx + 1);
  function mk(u) { return { id: 'abidc-' + idx, url: u, lang: lang3, language: lang3, label: lab, name: lab, title: lab }; }
  return next(0).then(function (text) {
    if (!text) { note('sub acilmadi'); return []; }
    if (!AYAR.ALTYAZI_YUKLE) return [mk(url)];
    return uploadText(vttToSrt(text), 'abi' + idx).then(function (u) { return u ? [mk(u)] : [mk(url)]; });
  }).catch(function () { return []; });
}

function makeStream(u, v, subs, idx) {
  var q = (u.match(/stream_v(\d{3,4})/i) || [])[1];
  var s = {
    name: AYAR.EKLENTI_ADI + (q ? ' - ' + q + 'p' : '') + (idx > 0 ? ' #' + (idx + 1) : ''),
    title: AYAR.EKLENTI_ADI + ' | TR' + (q ? ' | ' + q + 'p' : ''),
    url: u,
    quality: q ? q + 'p' : 'Auto',
    headers: v.headers,
    provider: PROVIDER_ID
  };
  if (/\.mp4(\?|$)/i.test(u)) s.type = 'mp4'; else s.type = 'hls';
  if (subs && subs.length) s.subtitles = subs;
  return s;
}

// ---------------- Ana akış ----------------

function getStreamsInner(tmdbId, mediaType, season, episode, holder) {
  var isTv = (mediaType === 'tv' || mediaType === 'series');
  dbg = ['v1.0.4'];
  var base = 'https://api.themoviedb.org/3/' + (isTv ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY;
  return Promise.all([
    getJson(base + '&language=tr-TR'),
    getJson(base + '&language=en-US').catch(function () { return {}; })
  ]).then(function (both) {
    var tr = both[0] || {}, en = both[1] || {};
    var titles = uniq([tr.title || tr.name, en.title || en.name, tr.original_title || tr.original_name]);
    var year = parseInt((tr.release_date || tr.first_air_date || '').slice(0, 4), 10) || 0;
    if (!titles.length) return debugStream('TMDB bilgisi eksik');
    note('film ' + titles[0] + ' ' + year);

    return findPage(titles, isTv ? 0 : year, isTv, season, episode).then(function (pg) {
      if (!pg) return debugStream('sayfa bulunamadi');
      var pageUrl = pg.url, blobs = [clean(pg.html)];
      var pages = playerPages(pg.html);
      note('oynatici sayfa ' + pages.length);
      var probe = clean(pg.html);
      function chunks(tag, str, n) {
        str = String(str).replace(/\s+/g, ' ');
        for (var i = 0, k = 0; i < str.length && k < n; i += 90, k++) note(tag + String.fromCharCode(97 + k) + ' ' + str.slice(i, i + 90));
      }
      var ix = probe.indexOf('data-player-type');
      chunks('1', ix >= 0 ? probe.slice(Math.max(0, ix - 200), ix + 300) : 'yok', 6);
      var names = uniq((pg.html.match(/\sdata-[\w-]+(?=\s*=)/gi) || []).map(function (x) { return x.trim(); }));
      chunks('2', names.join(' '), 3);
      var scr = uniq((probe.match(/<script[^>]+src=["'][^"']+/gi) || []).map(function (x) { return x.replace(/^.*src=["']/, '').replace(/^https?:\/\//, ''); })).filter(function (x) { return !/googleapis|gstatic|jquery|cloudflare|googletagmanager/i.test(x); });
      chunks('3', scr.join(' '), 3);
      var ajx = uniq(probe.match(/(?:ajax|fetch\(|\$\.(?:post|get)|XMLHttpRequest|wp-json|\/api\/)[^;\n]{0,80}/gi) || []);
      chunks('4', ajx.slice(0, 4).join(' | '), 4);

      return Promise.all(pages.map(function (u) { return siteGet(u, pageUrl, 'E'); })).then(function (rs) {
        var inner = [];
        rs.forEach(function (r) { if (r.status === 200) { blobs.push(clean(r.text)); inner = inner.concat(innerFrames(r.text)); } });
        inner = uniq(inner).slice(0, 4);
        return Promise.all(inner.map(function (u) { return siteGet(u, pageUrl, 'I'); }));
      }).then(function (rs2) {
        rs2.forEach(function (r) { if (r.status === 200) blobs.push(clean(r.text)); });

        var streams = streamsIn(blobs).slice(0, 6), subUrls = subsIn(blobs).slice(0, AYAR.ALTYAZI_SAYISI);
        note('akis ' + streams.length + ' sub ' + subUrls.length);
        if (!streams.length) return debugStream('akis linki sayfada yok');

        var sets = [
          { 'User-Agent': UA, 'Referer': AYAR.SITE + '/', 'Origin': AYAR.SITE },
          { 'User-Agent': UA, 'Referer': pageUrl, 'Origin': AYAR.SITE },
          { 'User-Agent': UA }
        ];
        var subsP = Promise.all(subUrls.map(function (u, i) { return prepSub(u, i, pageUrl); })).then(function (a) {
          var flat = []; a.forEach(function (x) { x.forEach(function (y) { flat.push(y); }); }); return flat;
        });
        return Promise.all([Promise.all(streams.map(function (u) { return verifyUrl(u, sets).then(function (v) { return { u: u, v: v }; }); })), subsP]).then(function (both2) {
          var vs = both2[0], subsF = both2[1];
          var good = vs.filter(function (x) { return x.v.ok; });
          if (!good.length) { note('dogrulanamadi (yine de eklendi)'); good = vs.slice(0, 1); }
          good.forEach(function (x, i) { holder.streams.push(makeStream(x.u, x.v, subsF, i)); });
          return holder.streams.length ? holder.streams : debugStream('kaynak cikmadi');
        });
      });
    });
  }).catch(function (e) { return holder.streams.length ? holder.streams : debugStream('hata ' + (e && e.message)); });
}

function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    var done = false, holder = { streams: [] };
    var timer = setTimeout(function () {
      if (!done) { done = true; resolve(holder.streams.length ? holder.streams : debugStream('zaman asimi')); }
    }, AYAR.GENEL_SURE);
    getStreamsInner(tmdbId, mediaType, season, episode, holder).then(function (r) {
      if (!done) { done = true; clearTimeout(timer); resolve(r || []); }
    }, function () {
      if (!done) { done = true; clearTimeout(timer); resolve(holder.streams); }
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
