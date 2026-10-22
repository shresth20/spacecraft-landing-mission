/* ============================================================
   Geo Drone — the loading bar's fetcher

   Every asset the mission needs is pulled through here before the
   start button is offered, so the bar behind it can show how many
   BYTES are in rather than how many files have settled.

     · each file is fetched with a streaming reader and reports
       every chunk, so the bar moves while a big file is coming in
       instead of jumping when it lands
     · files are weighted by their real size on disk (js/manifest.js,
       generated from the files themselves by tools/build_manifest.py)
       and re-weighted the moment a Content-Length comes back
     · smallest first, five at a time: the artwork the first screens
       are painted with is in within seconds and is never queued
       behind the three-megabyte theme
     · what comes back is handed on as a blob: URL, so an <img> or an
       <audio> that has been given one is playing from memory —
       "loaded" means local, not "in the HTTP cache, probably"
     · nothing here can hold the gate. A file that 404s, times out,
       stalls, comes up short of its Content-Length, or cannot be
       fetched at all (file://, an old browser) counts as done with
       its full weight and the element it was for keeps the URL it
       already had

   Formats: the artwork is WebP and the audio is Ogg Opus — both
   play in Chrome, Edge, Firefox and recent Safari (WebP 14+, Ogg
   Opus 17+ on macOS/iOS).
   ============================================================ */

(function (global) {
  'use strict';

  var CONCURRENCY = 5;
  var STALL_MS = 20000;       /* no bytes for this long → give up on the file */
  var HARD_MS  = 5 * 60000;   /* and a transfer still going after this */

  /* a nominal weight for a file the manifest does not know, until
     its Content-Length says otherwise */
  var GUESS = 60000;

  /* The server may not know these types (a bare static server hands
     out application/octet-stream for .webp and .ogg), so the blob is
     typed off the extension rather than off the header. */
  var TYPES = {
    webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', wav: 'audio/wav', webm: 'video/webm', mp4: 'video/mp4',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2'
  };

  function typeOf(url, header) {
    var m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url);
    var ext = m ? m[1].toLowerCase() : '';
    return TYPES[ext] || header || '';
  }

  /* Can this page fetch at all? A file:// page cannot (fetch of a
     file: URL is refused in every browser), and an old browser has
     no fetch. Either way every file is counted as done at once. */
  function canFetch() {
    return typeof global.fetch === 'function' &&
           typeof global.AbortController === 'function' &&
           typeof global.Blob === 'function' &&
           global.URL && typeof global.URL.createObjectURL === 'function' &&
           /^https?:$/.test(global.location.protocol);
  }

  /* ---------------------------------------------------------- run
     `items`  [{ url, size, apply }]
                url    what to fetch, absolute or relative
                size   its weight in bytes (0 = unknown)
                apply  fn(blobUrl), called once the file is fully in;
                       skipped on any failure. Optional.
     `onProgress(p)`  0..1, called whenever anything moves. Never
                      goes down: a re-weighting that would move it
                      back is held until the download catches up.

     Resolves — never rejects — once every item has settled, with a
     small tally for the console. */
  function run(items, onProgress) {
    items = (items || []).slice();
    var total = 0;
    var shown = 0;
    var tally = { ok: 0, failed: 0, bytes: 0 };

    items.forEach(function (it) {
      it.size = it.size > 0 ? it.size : GUESS;
      it.got = 0;
      it.done = false;
    });

    function retotal() {
      total = 0;
      items.forEach(function (it) { total += it.size; });
    }
    retotal();

    function report() {
      if (!onProgress) return;
      var got = 0;
      items.forEach(function (it) {
        got += it.done ? it.size : Math.min(it.got, it.size);
      });
      var p = total > 0 ? got / total : 1;
      if (p > 1) p = 1;
      if (p > shown) {
        shown = p;
        try { onProgress(shown); } catch (e) { /* the bar is decoration */ }
      }
    }

    if (!canFetch() || !items.length) {
      items.forEach(function (it) { it.done = true; });
      shown = 0;
      report();
      return Promise.resolve(tally);
    }

    /* smallest first: the posters, the plates and the click all land
       in the first second, and the theme goes last */
    items.sort(function (a, b) { return a.size - b.size; });

    function one(it) {
      return new Promise(function (resolve) {
        var settled = false;
        var ac = new AbortController();
        var stall = 0;
        var hard = 0;

        function clear() {
          clearTimeout(stall);
          clearTimeout(hard);
        }

        function settle(blob) {
          if (settled) return;
          settled = true;
          clear();
          it.done = true;
          if (blob) {
            tally.ok++;
            tally.bytes += blob.size;
            if (it.apply) {
              try { it.apply(URL.createObjectURL(blob)); }
              catch (e) { /* the element keeps its own src */ }
            }
          } else {
            tally.failed++;
          }
          report();
          resolve();
        }

        function abort() {
          try { ac.abort(); } catch (e) { /* already gone */ }
          settle(null);
        }

        /* plain timers, not GeoLife's: the network keeps moving
           while the tab is hidden, and a stall is a stall */
        function kick() {
          clearTimeout(stall);
          stall = setTimeout(abort, STALL_MS);
        }
        kick();
        hard = setTimeout(abort, HARD_MS);

        var p;
        try {
          p = fetch(it.url, { signal: ac.signal, credentials: 'same-origin' });
        } catch (e) {
          return settle(null);
        }

        p.then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);

          var cl = parseInt(res.headers.get('Content-Length'), 10);
          if (cl > 0 && cl !== it.size) {
            it.size = cl;
            retotal();
          }
          var type = typeOf(it.url, res.headers.get('Content-Type'));

          if (!res.body || typeof res.body.getReader !== 'function') {
            /* no streams: the whole file at once, progress on arrival */
            return res.blob().then(function (b) { return new Blob([b], { type: type }); });
          }

          var reader = res.body.getReader();
          var chunks = [];
          var n = 0;

          return (function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                /* a transfer the server cut short is not the file: a
                   picture made of it would decode blank from where it
                   stops, so it is counted as failed and the element
                   keeps its own URL */
                if (cl > 0 && n < cl) throw new Error('short: ' + n + ' of ' + cl);
                return new Blob(chunks, { type: type });
              }
              chunks.push(r.value);
              n += r.value.byteLength;
              it.got = n;
              kick();
              report();
              return pump();
            });
          })();
        }).then(settle, function () { settle(null); });
      });
    }

    var next = 0;
    function worker() {
      if (next >= items.length) return Promise.resolve();
      var it = items[next++];
      return one(it).then(worker);
    }

    var lanes = [];
    for (var i = 0; i < CONCURRENCY && i < items.length; i++) lanes.push(worker());

    report();
    return Promise.all(lanes).then(function () {
      items.forEach(function (it) { it.done = true; });
      report();
      return tally;
    });
  }

  global.GeoLoad = { run: run };
})(window);
