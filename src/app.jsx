    const { useState, useEffect, useRef, useMemo, useCallback } = React;

    // ─── Firebase Init ──────────────────────────────────────────
    const FIREBASE_READY = typeof FIREBASE_CONFIG !== "undefined"
      && FIREBASE_CONFIG.apiKey
      && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY_HERE";

    let db = null;
    let auth = null;
    if (FIREBASE_READY) {
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
    }

    const ADMIN_UID = "lF7taXh4NETa3h2UPZI6SGnWWcj2";

    // ─── Process Movie Database ─────────────────────────────────
    const TMDB_IMG = "https://image.tmdb.org/t/p/w200";
    const TMDB_IMG_LG = "https://image.tmdb.org/t/p/w300";
    // Share-card sizes are deliberately distinct from the ones <Poster> requests.
    // Those are fetched without crossOrigin; reusing an identical URL could hit the
    // non-CORS cache entry and taint the canvas at toBlob() time.
    const TMDB_IMG_XL = "https://image.tmdb.org/t/p/w500";
    const TMDB_IMG_MD = "https://image.tmdb.org/t/p/w342";
    const TMDB_API_KEY = (typeof TMDB_API_KEY_CONFIG !== "undefined" && TMDB_API_KEY_CONFIG)
      ? TMDB_API_KEY_CONFIG : "39a17d2f20e6ebc19af8eadbf015f5ab";
    const TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie";
    // Rolling cutoff for "New Releases" — anything from the previous calendar year onward.
    const NEW_RELEASE_YEAR = new Date().getFullYear() - 1;

    const GENRE_MAP = {28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Sci-Fi",10770:"TV Movie",53:"Thriller",10752:"War",37:"Western"};
    const TV_GENRE_MAP = {10759:"Action & Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",10762:"Kids",9648:"Mystery",10763:"News",10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",37:"Western"};

    const seen = new Set();
    const MOVIE_DB = MOVIE_DATA
      .map(([id, title, year, genre, poster]) => ({ id, title, year: String(year), genre, poster }))
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    const MOVIE_DB_IDS = new Set(MOVIE_DB.map(m => m.id));

    const tvSeen = new Set();
    const TV_DB = (typeof TV_DATA !== "undefined" ? TV_DATA : [])
      .map(([id, title, year, genre, poster]) => ({ id, title, year: String(year), genre, poster }))
      .filter(m => { if (tvSeen.has(m.id)) return false; tvSeen.add(m.id); return true; });
    const TV_DB_IDS = new Set(TV_DB.map(m => m.id));

    const TMDB_TV_SEARCH_URL = "https://api.themoviedb.org/3/search/tv";

    async function searchTMDBTV(query) {
      try {
        const resp = await fetch(`${TMDB_TV_SEARCH_URL}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.results || []).map(s => {
          const baseGenre = s.genre_ids && s.genre_ids.length ? (TV_GENRE_MAP[s.genre_ids[0]] || "Drama") : "Drama";
          const rating = s.vote_average || null;
          return { id: s.id, title: s.name, year: s.first_air_date ? s.first_air_date.slice(0, 4) : "", genre: baseGenre, poster: s.poster_path || null, rating };
        });
      } catch (e) {
        console.error("TMDB TV search error:", e);
        return [];
      }
    }

    async function searchTMDB(query) {
      try {
        const resp = await fetch(`${TMDB_SEARCH_URL}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.results || []).map(m => {
          const baseGenre = m.genre_ids && m.genre_ids.length ? (GENRE_MAP[m.genre_ids[0]] || "Drama") : "Drama";
          const rating = m.vote_average || null;
          return { id: m.id, title: m.title, year: m.release_date ? m.release_date.slice(0, 4) : "", genre: baseGenre, poster: m.poster_path || null, rating };
        });
      } catch (e) {
        console.error("TMDB search error:", e);
        return [];
      }
    }

    // ─── Poster Component ───────────────────────────────────────
    function Poster({ poster, title, className, style, size }) {
      const [failed, setFailed] = React.useState(false);
      // A new poster path deserves a fresh attempt
      React.useEffect(() => { setFailed(false); }, [poster]);
      const base = size === "lg" ? TMDB_IMG_LG : TMDB_IMG;
      if (poster && !failed) {
        return <img src={`${base}${poster}`} alt={title} className={className} style={style} loading="lazy" onError={() => setFailed(true)} />;
      }
      return (
        <div className={`poster-placeholder ${className || ""}`} style={style}>
          {title ? title.slice(0, 20) : "?"}
        </div>
      );
    }

    // ─── Score Calculation ───────────────────────────────────────
    function getScore(index, total) {
      if (total <= 1) return 10.0;
      return Math.round((10.0 * (1 - index / (total - 1))) * 10) / 10;
    }

    function scoreClass(score) {
      if (score >= 7) return "score-high";
      if (score >= 4) return "score-mid";
      return "score-low";
    }

    // ─── Share Card Canvas ──────────────────────────────────────
    // Draws a shareable social image entirely with Canvas 2D. Deliberately
    // reads from literal constants rather than CSS variables so the export is
    // identical regardless of day-mode / viewport / device pixel ratio.
    const SHARE_SITE_URL = "https://movirank.com";
    const SHARE_TAGLINE = "Every movie ranked, one matchup at a time.";
    const SHARE_TAGLINE_TV = "Every show ranked, one matchup at a time.";

    const SHARE_THEMES = {
      movie: { bg: "#0F0E0D", surface: "#1C1A18", surface2: "#262320", accent: "#FF4D4D", accentGlow: "rgba(255,77,77,0.22)", accentSoft: "rgba(255,77,77,0.07)" },
      tv:    { bg: "#0D120F", surface: "#151C18", surface2: "#1E2722", accent: "#00875A", accentGlow: "rgba(0,135,90,0.24)", accentSoft: "rgba(0,135,90,0.09)" },
    };
    const SHARE_TEXT = "#F5F3EF";
    const SHARE_MUTED = "#9A968E";
    const OUTFIT = '"Outfit", "Helvetica Neue", Arial, sans-serif';
    const DMSANS = '"DM Sans", "Helvetica Neue", Arial, sans-serif';

    // Every coordinate lives here so both aspect ratios share one drawing pass.
    const SHARE_LAYOUTS = {
      feed: {
        w: 1080, h: 1350, pad: 72,
        logoY: 40, logoScale: 0.88, wordmarkY: 166, wordmarkSize: 52, wordmarkTrack: 15,
        bylineY: 208, bylineSize: 24, bylineTrack: 4,
        rowH: 126, posterW: 84, rowGap: 24,
        aboveY: 232, heroY: 382, heroX: 305, heroW: 470, heroH: 705, belowY: 1124,
        footerY: 1296, footerSize: 40, taglineSize: 22, taglineGap: 32,
        heroTitleSizes: [54, 48, 42, 36],
        rankSize: 44, rankBadgeH: 74, scoreSize: 76, scorePillH: 112,
      },
      // Kept clear of the Story UI: nothing above y=200 or below y=1760.
      story: {
        w: 1080, h: 1920, pad: 80,
        logoY: 210, logoScale: 1.0, wordmarkY: 360, wordmarkSize: 60, wordmarkTrack: 17,
        bylineY: 412, bylineSize: 27, bylineTrack: 4,
        rowH: 150, posterW: 100, rowGap: 28,
        aboveY: 452, heroY: 626, heroX: 270, heroW: 540, heroH: 810, belowY: 1490,
        footerY: 1706, footerSize: 46, taglineSize: 25, taglineGap: 38,
        heroTitleSizes: [60, 53, 46, 40],
        rankSize: 50, rankBadgeH: 84, scoreSize: 86, scorePillH: 126,
      },
    };

    function shareScoreRGB(score) {
      if (score >= 7) return "79,185,106";
      if (score >= 4) return "245,197,24";
      return "154,150,142";
    }

    // Resolves to null (never rejects) so one dead poster degrades to a
    // placeholder tile instead of failing the whole card.
    function loadImageCORS(url) {
      return new Promise(function(resolve) {
        if (!url) { resolve(null); return; }
        var settled = false;
        var done = function(v) { if (!settled) { settled = true; resolve(v); } };
        var img = new Image();
        img.crossOrigin = "anonymous"; // must be set before src
        img.onload = function() { done(img); };
        img.onerror = function() { done(null); };
        img.src = url;
        setTimeout(function() { done(null); }, 6000);
      });
    }

    // ctx.roundRect only landed in Safari 16.4 and this site runs as an iOS PWA.
    function roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
      var rr = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y,     x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x,     y + h, rr);
      ctx.arcTo(x,     y + h, x,     y,     rr);
      ctx.arcTo(x,     y,     x + w, y,     rr);
      ctx.closePath();
    }

    function drawImageCover(ctx, img, x, y, w, h, r) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, r);
      ctx.clip();
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      var scale = Math.max(w / iw, h / ih);
      var dw = iw * scale;
      var dh = ih * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
    }

    function truncateToWidth(ctx, text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      var lo = 0, hi = text.length;
      while (lo < hi) {
        var mid = Math.ceil((lo + hi) / 2);
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
      }
      return text.slice(0, lo).replace(/\s+$/, "") + "…";
    }

    function wrapText(ctx, text, maxW, maxLines) {
      var words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
      var lines = [];
      var cur = "";
      var i = 0;
      while (i < words.length && lines.length < maxLines) {
        var trial = cur ? cur + " " + words[i] : words[i];
        if (!cur || ctx.measureText(trial).width <= maxW) { cur = trial; i++; }
        else { lines.push(cur); cur = ""; }
      }
      if (cur && lines.length < maxLines) { lines.push(cur); cur = ""; }
      if (!lines.length) return [];
      var last = lines.length - 1;
      var leftover = (i < words.length) || cur;
      lines[last] = truncateToWidth(ctx, leftover ? lines[last] + " " + (words[i] || "") : lines[last], maxW);
      return lines;
    }

    // Picks the largest size that fits without ellipsizing; falls back to the
    // smallest. Keeps "The Assassination of Jesse James…" readable.
    function fitText(ctx, text, maxW, maxLines, sizes, weight, family) {
      for (var i = 0; i < sizes.length; i++) {
        ctx.font = weight + " " + sizes[i] + "px " + family;
        var lines = wrapText(ctx, text, maxW, maxLines);
        var clipped = lines.some(function(l) { return l.slice(-1) === "…"; });
        if (!clipped) return { size: sizes[i], lines: lines };
      }
      var small = sizes[sizes.length - 1];
      ctx.font = weight + " " + small + "px " + family;
      return { size: small, lines: wrapText(ctx, text, maxW, maxLines) };
    }

    // Always drawn char-by-char: ctx.letterSpacing is Chrome 99+/Safari 17.4+
    // and the tracked MOVI wordmark is the whole point of the branding.
    function trackedWidth(ctx, text, tracking) {
      var w = 0;
      for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + tracking;
      return w - (text.length ? tracking : 0);
    }

    function drawTracked(ctx, text, cx, y, tracking, align) {
      var total = trackedWidth(ctx, text, tracking);
      var x = align === "left" ? cx : (align === "right" ? cx - total : cx - total / 2);
      var prev = ctx.textAlign;
      ctx.textAlign = "left";
      for (var i = 0; i < text.length; i++) {
        ctx.fillText(text[i], x, y);
        x += ctx.measureText(text[i]).width + tracking;
      }
      ctx.textAlign = prev;
      return total;
    }

    // Titles without artwork get a ghosted film frame rather than their own
    // name — the title is already spelled out next to (or on top of) the tile.
    function drawFilmGlyph(ctx, cx, cy, scale, color) {
      ctx.save();
      ctx.translate(cx - 31 * scale, cy - 41 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 3;
      roundRectPath(ctx, 0, 0, 62, 82, 4);
      ctx.stroke();
      roundRectPath(ctx, 24, 5, 14, 5, 1); ctx.fill();
      roundRectPath(ctx, 24, 72, 14, 5, 1); ctx.fill();
      ctx.restore();
    }

    function drawPosterPlaceholder(ctx, x, y, w, h, r, theme) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fillStyle = theme.surface2;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.clip();
      drawFilmGlyph(ctx, x + w / 2, y + h * 0.42, Math.max(0.5, w / 190), "rgba(245,243,239,0.16)");
      ctx.restore();
    }

    // Film-strip mark, geometry lifted from og-image.svg so the card matches
    // the site header exactly. Natural bounds 198x82, drawn centered on cx.
    function drawLogoStrip(ctx, cx, top, scale, theme) {
      ctx.save();
      ctx.translate(cx - (198 * scale) / 2, top);
      ctx.scale(scale, scale);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";

      var idle = function(fx, label) {
        roundRectPath(ctx, fx, 8, 62, 74, 3);
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.13)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        roundRectPath(ctx, fx + 24, 12, 14, 4, 1); ctx.fill();
        roundRectPath(ctx, fx + 24, 74, 14, 4, 1); ctx.fill();
        ctx.font = "800 30px " + OUTFIT;
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillText(label, fx + 31, 56);
      };
      idle(0, "3");
      idle(136, "2");

      ctx.save();
      ctx.translate(93, 45); ctx.scale(1.1, 1.1); ctx.translate(-93, -45);
      roundRectPath(ctx, 62, 0, 62, 82, 3);
      ctx.fillStyle = theme.accentSoft;
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.28;
      roundRectPath(ctx, 86, 4, 14, 4, 1); ctx.fill();
      roundRectPath(ctx, 86, 74, 14, 4, 1); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = "800 30px " + OUTFIT;
      ctx.fillText("1", 93, 53);
      ctx.restore();

      ctx.restore();
    }

    // A neighbour row: rank number, small poster, title, year - genre.
    function drawNeighborRow(ctx, L, y, entry, rank, img, theme) {
      var h = L.rowH;
      var pw = L.posterW;
      var px = L.pad + 96;
      ctx.save();
      ctx.globalAlpha = 0.62;

      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "right";
      ctx.font = "800 40px " + OUTFIT;
      ctx.fillStyle = "rgba(245,243,239,0.45)";
      ctx.fillText("#" + rank, L.pad + 78, y + h / 2 + 14);

      if (img) drawImageCover(ctx, img, px, y, pw, h, 8);
      else drawPosterPlaceholder(ctx, px, y, pw, h, 8, theme);

      var tx = px + pw + L.rowGap;
      var maxW = L.w - tx - L.pad;
      ctx.textAlign = "left";
      ctx.fillStyle = SHARE_TEXT;
      var fitted = fitText(ctx, entry.title, maxW, 1, [36, 32, 28], "600", OUTFIT);
      ctx.fillText(fitted.lines[0] || "", tx, y + h / 2 + 2);

      ctx.font = "400 26px " + DMSANS;
      ctx.fillStyle = SHARE_MUTED;
      var meta = [entry.year, entry.genre].filter(Boolean).join("  ·  ");
      ctx.fillText(truncateToWidth(ctx, meta, maxW), tx, y + h / 2 + 42);

      ctx.restore();
    }

    // Stand-in when the ranked title has no neighbour above/below it.
    function drawSentinelRow(ctx, L, y, label) {
      var h = L.rowH;
      var cy = y + h / 2;
      ctx.save();
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = "700 26px " + OUTFIT;
      ctx.fillStyle = "rgba(245,243,239,0.34)";
      var w = drawTracked(ctx, label, L.w / 2, cy, 4, "center");
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(L.pad, cy); ctx.lineTo(L.w / 2 - w / 2 - 28, cy);
      ctx.moveTo(L.w / 2 + w / 2 + 28, cy); ctx.lineTo(L.w - L.pad, cy);
      ctx.stroke();
      ctx.restore();
    }

    /**
     * Renders the share card and returns the canvas.
     * opts: { movie, rank, total, score, isTV, above, below, displayName, format }
     */
    async function renderShareCard(opts) {
      var L = SHARE_LAYOUTS[opts.format] || SHARE_LAYOUTS.feed;
      var theme = opts.isTV ? SHARE_THEMES.tv : SHARE_THEMES.movie;
      var kind = opts.isTV ? "TV" : "MOVIE";

      // Google serves subsetted woff2 with display=swap, so load() has to be
      // given the actual glyphs or fillText silently falls back to Helvetica.
      var glyphs = (opts.movie.title || "") + (opts.movie.genre || "") + (opts.displayName || "");
      try {
        await Promise.all([
          document.fonts.load('900 60px "Outfit"', "MOVI0123456789#"),
          document.fonts.load('800 56px "Outfit"', glyphs + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
          document.fonts.load('600 36px "Outfit"', glyphs),
          document.fonts.load('400 28px "DM Sans"', glyphs + SHARE_TAGLINE + SHARE_TAGLINE_TV + SHARE_SITE_URL),
        ]);
        await document.fonts.ready;
      } catch (e) { /* fall back to system fonts rather than block the card */ }

      var loads = [
        loadImageCORS(opts.movie.poster ? TMDB_IMG_XL + opts.movie.poster : null),
        loadImageCORS(opts.above && opts.above.poster ? TMDB_IMG_MD + opts.above.poster : null),
        loadImageCORS(opts.below && opts.below.poster ? TMDB_IMG_MD + opts.below.poster : null),
      ];
      var imgs = await Promise.all(loads);
      var heroImg = imgs[0], aboveImg = imgs[1], belowImg = imgs[2];

      var canvas = document.createElement("canvas");
      canvas.width = L.w;
      canvas.height = L.h;
      var ctx = canvas.getContext("2d");
      ctx.textBaseline = "alphabetic";

      // 1. base
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, L.w, L.h);

      // 2. blurred poster backdrop (ctx.filter is unsupported in Safari < 17)
      var canBlur = false;
      try { ctx.filter = "blur(2px)"; canBlur = ctx.filter !== "none"; ctx.filter = "none"; } catch (e) {}
      if (heroImg && canBlur) {
        ctx.save();
        ctx.filter = "blur(60px)";
        ctx.globalAlpha = 0.22;
        drawImageCover(ctx, heroImg, -80, -80, L.w + 160, L.h + 160, 0);
        ctx.restore();
        ctx.filter = "none";
      }

      // 3. accent glow behind the hero
      var gx = L.heroX + L.heroW / 2;
      var gy = L.heroY + L.heroH / 2;
      var glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, L.w * 0.85);
      glow.addColorStop(0, theme.accentGlow);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, L.w, L.h);

      // 4. 36px grid, same values as og-image.svg
      ctx.strokeStyle = "rgba(255,255,255,0.018)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gxr = 0; gxr <= L.w; gxr += 36) { ctx.moveTo(gxr + 0.5, 0); ctx.lineTo(gxr + 0.5, L.h); }
      for (var gyr = 0; gyr <= L.h; gyr += 36) { ctx.moveTo(0, gyr + 0.5); ctx.lineTo(L.w, gyr + 0.5); }
      ctx.stroke();

      // 5. bottom darkening so the footer stays legible over the backdrop
      var fade = ctx.createLinearGradient(0, L.h - 320, 0, L.h);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = fade;
      ctx.fillRect(0, L.h - 320, L.w, 320);

      // 6. header: film strip + wordmark
      drawLogoStrip(ctx, L.w / 2, L.logoY, L.logoScale, theme);
      ctx.font = "900 " + L.wordmarkSize + "px " + OUTFIT;
      ctx.fillStyle = SHARE_TEXT;
      drawTracked(ctx, "MOVI", L.w / 2, L.wordmarkY, L.wordmarkTrack, "center");

      // byline
      var who = (opts.displayName || "").trim();
      var first = who ? who.split(/\s+/)[0].toUpperCase() : "";
      var byline;
      if (opts.total <= 1) byline = "MY FIRST RANKED " + kind;
      else byline = (first ? first + "'S " : "MY ") + kind + " RANKING · " + opts.total + " RANKED";
      ctx.font = "700 " + L.bylineSize + "px " + OUTFIT;
      ctx.fillStyle = SHARE_MUTED;
      drawTracked(ctx, byline, L.w / 2, L.bylineY, L.bylineTrack, "center");

      // 7. above / hero / below
      if (opts.above) drawNeighborRow(ctx, L, L.aboveY, opts.above, opts.rank - 1, aboveImg, theme);
      else drawSentinelRow(ctx, L, L.aboveY, "▲  TOP OF MY LIST");

      if (opts.below) drawNeighborRow(ctx, L, L.belowY, opts.below, opts.rank + 1, belowImg, theme);
      else drawSentinelRow(ctx, L, L.belowY, "▼  BOTTOM OF MY LIST");

      // hero poster
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 60;
      ctx.shadowOffsetY = 18;
      roundRectPath(ctx, L.heroX, L.heroY, L.heroW, L.heroH, 20);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.restore();

      if (heroImg) drawImageCover(ctx, heroImg, L.heroX, L.heroY, L.heroW, L.heroH, 20);
      else drawPosterPlaceholder(ctx, L.heroX, L.heroY, L.heroW, L.heroH, 20, theme);

      // Measured up front: the pill overlaps the poster's bottom-right, so the
      // "year · genre" line underneath has to know how much room is left.
      var scoreRGB = shareScoreRGB(opts.score);
      var scoreLabel = opts.score.toFixed(1);
      var sufSize = Math.round(L.scoreSize * 0.34);
      ctx.font = "900 " + L.scoreSize + "px " + OUTFIT;
      var scoreW = ctx.measureText(scoreLabel).width;
      ctx.font = "700 " + sufSize + "px " + OUTFIT;
      var sufW = ctx.measureText("/10").width;
      var pillPad = Math.round(L.scoreSize * 0.40);
      var pillW = scoreW + 8 + sufW + pillPad * 2;
      var pillH = L.scorePillH;

      // title scrim baked onto the poster keeps the above/hero/below sandwich tight
      ctx.save();
      roundRectPath(ctx, L.heroX, L.heroY, L.heroW, L.heroH, 20);
      ctx.clip();
      var scrimTop = L.heroY + L.heroH - 300;
      var scrim = ctx.createLinearGradient(0, scrimTop, 0, L.heroY + L.heroH);
      scrim.addColorStop(0, "rgba(0,0,0,0)");
      scrim.addColorStop(0.55, "rgba(0,0,0,0.72)");
      scrim.addColorStop(1, "rgba(0,0,0,0.94)");
      ctx.fillStyle = scrim;
      ctx.fillRect(L.heroX, scrimTop, L.heroW, 300);

      var tx = L.heroX + 28;
      var tMaxW = L.heroW - 56;
      var metaBaseline = L.heroY + L.heroH - 40;
      ctx.textAlign = "left";
      ctx.font = "400 26px " + DMSANS;
      ctx.fillStyle = "rgba(245,243,239,0.72)";
      var meta = [opts.movie.year, opts.movie.genre].filter(Boolean).join("  ·  ");
      var metaMaxW = Math.max(150, L.heroW - pillW - 18);
      ctx.fillText(truncateToWidth(ctx, meta, metaMaxW), tx, metaBaseline);

      var fitted = fitText(ctx, opts.movie.title, tMaxW, 2, L.heroTitleSizes, "800", OUTFIT);
      ctx.fillStyle = "#FFFFFF";
      var lh = fitted.size * 1.14;
      var titleBottom = metaBaseline - 46;
      for (var li = 0; li < fitted.lines.length; li++) {
        var yy = titleBottom - (fitted.lines.length - 1 - li) * lh;
        ctx.fillText(fitted.lines[li], tx, yy);
      }
      ctx.restore();

      // accent border on top of the artwork
      ctx.save();
      roundRectPath(ctx, L.heroX + 1.5, L.heroY + 1.5, L.heroW - 3, L.heroH - 3, 19);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // rank badge, overlapping the hero's top-left corner
      ctx.save();
      ctx.font = "900 " + L.rankSize + "px " + OUTFIT;
      var rankLabel = "#" + opts.rank;
      var badgeW = Math.max(92, ctx.measureText(rankLabel).width + 38);
      var badgeH = L.rankBadgeH;
      var badgeX = L.heroX - 24;
      var badgeY = L.heroY - 28;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 8;
      var bg = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
      bg.addColorStop(0, theme.accent);
      bg.addColorStop(1, opts.isTV ? "#2DAF7C" : "#FF7A3D");
      roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 18);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(rankLabel, badgeX + badgeW / 2, badgeY + badgeH / 2 + Math.round(L.rankSize * 0.36));
      ctx.restore();

      // Score pill, overlapping the hero's bottom-right corner. This is the
      // headline number — deliberately larger than the rank badge, and suffixed
      // "/10" so a viewer reads it as a rating rather than another position.
      ctx.save();
      var pillX = L.heroX + L.heroW + 26 - pillW;
      var pillY = L.heroY + L.heroH - pillH / 2 - 10;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fillStyle = "rgba(12,10,9,0.94)";
      ctx.fill();
      ctx.shadowColor = "transparent";
      roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fillStyle = "rgba(" + scoreRGB + ",0.16)";
      ctx.fill();
      ctx.strokeStyle = "rgba(" + scoreRGB + ",0.55)";
      ctx.lineWidth = 3;
      ctx.stroke();

      var baseline = pillY + pillH / 2 + Math.round(L.scoreSize * 0.35);
      ctx.textAlign = "left";
      ctx.font = "900 " + L.scoreSize + "px " + OUTFIT;
      ctx.fillStyle = "rgb(" + scoreRGB + ")";
      ctx.fillText(scoreLabel, pillX + pillPad, baseline);
      ctx.font = "700 " + sufSize + "px " + OUTFIT;
      ctx.fillStyle = "rgba(" + scoreRGB + ",0.6)";
      ctx.fillText("/10", pillX + pillPad + scoreW + 8, baseline);
      ctx.restore();

      // 8. footer branding — the whole reason the card exists
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "800 " + L.footerSize + "px " + OUTFIT;
      ctx.fillStyle = theme.accent;
      drawTracked(ctx, "movirank.com", L.w / 2, L.footerY, 2, "center");
      ctx.font = "400 " + L.taglineSize + "px " + DMSANS;
      ctx.fillStyle = SHARE_MUTED;
      ctx.fillText(opts.isTV ? SHARE_TAGLINE_TV : SHARE_TAGLINE, L.w / 2, L.footerY + L.taglineGap);
      ctx.restore();

      return canvas;
    }

    // A private profile link dead-ends on the lock screen, which is the worst
    // possible landing for a follower, so fall back to the homepage.
    function shareProfileLink(item, user, isPrivate) {
      if (user && !isPrivate) {
        return SHARE_SITE_URL + "/?u=" + user.uid + (item.isTV ? "&type=tv" : "");
      }
      return SHARE_SITE_URL;
    }

    function buildShareCaption(item, user, isPrivate) {
      var kind = item.isTV ? "show" : "movie";
      var name = user && user.displayName ? user.displayName.trim().split(/\s+/)[0] : "";
      var who = name ? name + "'s" : "my";
      var link = shareProfileLink(item, user, isPrivate);
      var tags = item.isTV ? "#movirank #tvshows #ranking" : "#movirank #letterboxd #filmtwitter";
      var year = item.movie.year ? " (" + item.movie.year + ")" : "";
      var head = item.movie.title + year + " just landed at #" + item.rank + " of " + item.total +
        " in " + who + " " + kind + " ranking — " + item.score.toFixed(1) + "/10.";
      var body = head + "\n\nRank yours: " + link;
      // X bills every URL at 23 chars regardless of length.
      var billed = body.length - link.length + 23 + tags.length + 2;
      return billed <= 280 ? body + "\n\n" + tags : body;
    }

    // ─── Letterboxd Import ──────────────────────────────────────
    // Parse a single CSV line preserving empty fields and handling quoted
    // segments (including escaped double quotes). The regex previously used
    // collapsed consecutive commas, which misaligned columns whenever a
    // field like Year was blank.
    function splitCsvLine(line) {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { cur += ch; }
        } else {
          if (ch === ',') { out.push(cur); cur = ""; }
          else if (ch === '"') { inQuotes = true; }
          else { cur += ch; }
        }
      }
      out.push(cur);
      return out;
    }

    async function extractLetterboxdRatings(file) {
      let csvText;
      if (file.name.endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const csvFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith("ratings.csv"));
        if (!csvFile) throw new Error("No ratings.csv found in ZIP");
        csvText = await zip.files[csvFile].async("string");
      } else {
        csvText = await file.text();
      }
      const lines = csvText.split("\n").map(l => l.trim()).filter(l => l);
      if (lines.length < 2) throw new Error("CSV file is empty");
      // Parse header to find column indices
      const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
      const nameIdx = header.indexOf("name");
      const yearIdx = header.indexOf("year");
      const ratingIdx = header.indexOf("rating");
      if (nameIdx === -1 || ratingIdx === -1) throw new Error("CSV missing Name or Rating columns");
      const entries = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (!cols.length) continue;
        const name = (cols[nameIdx] || "").trim();
        const year = yearIdx !== -1 ? (cols[yearIdx] || "").trim() : "";
        const rating = parseFloat(cols[ratingIdx] || "0");
        if (name && !isNaN(rating) && rating > 0) {
          entries.push({ title: name, year, lbRating: rating });
        }
      }
      // Sort by rating desc (ties resolved later by TMDB vote average)
      entries.sort((a, b) => b.lbRating - a.lbRating);
      return entries;
    }

    async function lookupTMDB(title, year) {
      try {
        let url = `${TMDB_SEARCH_URL}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&include_adult=false&language=en-US&page=1`;
        if (year) url += `&year=${year}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.results || data.results.length === 0) {
          // Fallback: try without year
          if (year) return lookupTMDB(title, "");
          return null;
        }
        const m = data.results[0];
        const baseGenre = m.genre_ids && m.genre_ids.length ? (GENRE_MAP[m.genre_ids[0]] || "Drama") : "Drama";
        return { id: m.id, title: m.title, year: m.release_date ? m.release_date.slice(0, 4) : "", genre: baseGenre, poster: m.poster_path || null, rating: m.vote_average || null };
      } catch (e) {
        return null;
      }
    }

    // ─── Binary Insertion ───────────────────────────────────────
    const GENRE_MIN_PEERS = 3;

    function globalIndexOf(list, movie) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === movie.id) return i;
      }
      return -1;
    }

    function createSession(newMovie, rankedList) {
      if (newMovie.genre && rankedList.length > 0) {
        const gs = buildGenreSession(newMovie, rankedList);
        if (gs) return gs;
      }
      const session = {
        newMovie, list: rankedList, low: 0, high: rankedList.length,
        step: 0, maxSteps: Math.ceil(Math.log2(rankedList.length + 1)), phase: null,
      };
      return advanceSession(session);
    }

    function buildGenreSession(newMovie, rankedList) {
      const genreList = rankedList.filter(m => m.genre === newMovie.genre);
      if (genreList.length < GENRE_MIN_PEERS) return null;
      const phase1Steps = Math.ceil(Math.log2(genreList.length + 1));
      const phase2StepsEst = Math.ceil(Math.log2(rankedList.length + 1));
      return advanceSession({
        newMovie, list: rankedList, genreList, genreInsertIdx: null,
        phase: 1, low: 0, high: genreList.length,
        step: 0, phase1Steps, phase2Steps: phase2StepsEst,
        maxSteps: phase1Steps + phase2StepsEst,
      });
    }

    function transitionToPhase2(session) {
      const genreInsertIdx = session.low;
      const { genreList, list } = session;
      let globalLow, globalHigh;

      if (genreInsertIdx === 0) {
        globalLow = 0;
        globalHigh = globalIndexOf(list, genreList[0]);
      } else if (genreInsertIdx === genreList.length) {
        globalLow = globalIndexOf(list, genreList[genreList.length - 1]) + 1;
        globalHigh = list.length;
      } else {
        globalLow = globalIndexOf(list, genreList[genreInsertIdx - 1]) + 1;
        globalHigh = globalIndexOf(list, genreList[genreInsertIdx]);
      }

      if (globalLow >= globalHigh) {
        return { ...session, done: true, insertIndex: globalLow, genreInsertIdx, phase: 2 };
      }
      const phase2Steps = Math.ceil(Math.log2(globalHigh - globalLow + 1));
      return advanceSession({
        ...session, phase: 2, genreInsertIdx, low: globalLow, high: globalHigh,
        phase2Steps, maxSteps: session.phase1Steps + phase2Steps,
      });
    }

    function advanceSession(session) {
      if (session.phase === 1) {
        if (session.low >= session.high) return transitionToPhase2(session);
        const mid = Math.floor((session.low + session.high) / 2);
        return { ...session, done: false, compareMovie: session.genreList[mid], mid };
      }
      if (session.low >= session.high) return { ...session, done: true, insertIndex: session.low };
      const mid = Math.floor((session.low + session.high) / 2);
      return { ...session, done: false, compareMovie: session.list[mid], mid };
    }

    function recordChoice(session, preferNew) {
      const next = {
        ...session, step: session.step + 1,
        low: preferNew ? session.low : session.mid + 1,
        high: preferNew ? session.mid : session.high,
      };
      return advanceSession(next);
    }

    // ─── Firestore Helpers ──────────────────────────────────────
    const MILESTONES = [10, 25, 50, 100, 200, 500];

    async function writeActivityEvent(event) {
      if (!db) return;
      try {
        await db.collection("activity").add(event);
        _lastActivityWrite = Date.now();
      } catch (e) {
        console.error("Failed to write activity:", e);
      }
    }

    var _lastActivityWrite = 0;

    async function saveProfile(user, rankedList, tvRankedList, watchlist, tvWatchlist, isPrivate) {
      if (!db || !user) return;
      try {
        // Load existing profile to detect changes for activity feed
        var oldDoc = await db.collection("profiles").doc(user.uid).get();
        var oldData = oldDoc.exists ? oldDoc.data() : null;
        var oldMovieCount = oldData ? (oldData.movieCount || 0) : 0;
        var oldTop10Ids = oldData && oldData.movies ? oldData.movies.slice(0, 10).map(function(m) { return m.id; }).join(",") : "";

        const toSave = m => ({ id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, rating: m.rating || null });
        await db.collection("profiles").doc(user.uid).set({
          displayName: user.displayName || "Anonymous",
          photoURL: user.photoURL || null,
          movies: rankedList.map(toSave),
          movieCount: rankedList.length,
          tvShows: tvRankedList.map(toSave),
          tvShowCount: tvRankedList.length,
          watchlist: (watchlist || []).map(toSave),
          watchlistCount: (watchlist || []).length,
          tvWatchlist: (tvWatchlist || []).map(toSave),
          tvWatchlistCount: (tvWatchlist || []).length,
          isPrivate: !!isPrivate,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Throttle activity writes: max once per 30s (client-side tracking)
        var now = Date.now();
        if (now - _lastActivityWrite < 30000) return;

        var baseEvent = {
          uid: user.uid,
          displayName: user.displayName || "Anonymous",
          photoURL: user.photoURL || null,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Priority: joined > milestone > top10 > ranked (check both movies and TV)
        if (!oldData) {
          writeActivityEvent(Object.assign({}, baseEvent, { type: "joined", movie: null, rank: null, count: null }));
        } else {
          var newMovieCount = rankedList.length;
          var newTvCount = tvRankedList.length;
          var oldTvCount = oldData.tvShowCount || 0;
          var oldTvTop10Ids = oldData.tvShows ? oldData.tvShows.slice(0, 10).map(function(m) { return m.id; }).join(",") : "";

          // Check movie milestone
          var hitMilestone = null;
          for (var mi = 0; mi < MILESTONES.length; mi++) {
            if (oldMovieCount < MILESTONES[mi] && newMovieCount >= MILESTONES[mi]) {
              hitMilestone = MILESTONES[mi];
            }
          }
          if (hitMilestone) {
            writeActivityEvent(Object.assign({}, baseEvent, { type: "milestone", movie: null, rank: null, count: hitMilestone }));
          } else {
            // Check movie top 10 change
            var newTop10Ids = rankedList.slice(0, 10).map(function(m) { return m.id; }).join(",");
            if (oldTop10Ids && newTop10Ids !== oldTop10Ids && oldMovieCount >= 10) {
              writeActivityEvent(Object.assign({}, baseEvent, { type: "top10", movie: null, rank: null, count: null }));
            } else if (newMovieCount > oldMovieCount) {
              // New movie ranked
              var oldMovieIds = new Set((oldData.movies || []).map(function(m) { return m.id; }));
              var newest = null;
              var newestRank = null;
              for (var ri = 0; ri < rankedList.length; ri++) {
                if (!oldMovieIds.has(rankedList[ri].id)) {
                  newest = rankedList[ri];
                  newestRank = ri + 1;
                  break;
                }
              }
              if (newest) {
                writeActivityEvent(Object.assign({}, baseEvent, {
                  type: "ranked",
                  movie: { id: newest.id, title: newest.title, poster: newest.poster || null },
                  rank: newestRank,
                  count: null
                }));
              }
            } else if (newTvCount > oldTvCount) {
              // New TV show ranked
              var oldTvIds = new Set((oldData.tvShows || []).map(function(m) { return m.id; }));
              var newestTv = null;
              var newestTvRank = null;
              for (var ti = 0; ti < tvRankedList.length; ti++) {
                if (!oldTvIds.has(tvRankedList[ti].id)) {
                  newestTv = tvRankedList[ti];
                  newestTvRank = ti + 1;
                  break;
                }
              }
              if (newestTv) {
                writeActivityEvent(Object.assign({}, baseEvent, {
                  type: "ranked",
                  movie: { id: newestTv.id, title: newestTv.title, poster: newestTv.poster || null },
                  rank: newestTvRank,
                  count: null,
                  isTV: true
                }));
              }
            } else {
              // Check TV top 10 change
              var newTvTop10Ids = tvRankedList.slice(0, 10).map(function(m) { return m.id; }).join(",");
              if (oldTvTop10Ids && newTvTop10Ids !== oldTvTop10Ids && oldTvCount >= 10) {
                writeActivityEvent(Object.assign({}, baseEvent, { type: "top10", movie: null, rank: null, count: null, isTV: true }));
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to save profile:", e);
      }
    }

    async function loadActivityFeed(limit) {
      if (!db) return [];
      try {
        var snap = await db.collection("activity")
          .orderBy("timestamp", "desc")
          .limit(limit || 20)
          .get();
        return snap.docs.map(function(d) {
          var data = d.data();
          data._id = d.id;
          return data;
        });
      } catch (e) {
        console.error("Failed to load activity feed:", e);
        return [];
      }
    }

    async function loadProfile(uid) {
      if (!db) return null;
      try {
        const doc = await db.collection("profiles").doc(uid).get();
        if (doc.exists) return doc.data();
      } catch (e) {
        console.error("Failed to load profile:", e);
      }
      return null;
    }

    async function adminSaveProfile(uid, movies, tvShows) {
      if (!db) return;
      try {
        const toSave = m => ({ id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, rating: m.rating || null });
        await db.collection("profiles").doc(uid).update({
          movies: movies.map(toSave),
          movieCount: movies.length,
          tvShows: tvShows.map(toSave),
          tvShowCount: tvShows.length,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to admin save profile:", e);
      }
    }

    async function deleteProfile(uid) {
      if (!db) return;
      try {
        await db.collection("profiles").doc(uid).delete();
      } catch (e) {
        console.error("Failed to delete profile:", e);
      }
    }

    // ─── Compatibility Score ──────────────────────────────────
    function computeListCompatibility(myList, theirList) {
      if (!myList || !theirList || myList.length < 2 || theirList.length < 2) return null;
      const myMap = {};
      myList.forEach((m, i) => { myMap[m.id] = i / myList.length; });
      const theirMap = {};
      theirList.forEach((m, i) => { theirMap[m.id] = i / theirList.length; });
      const sharedIds = Object.keys(myMap).filter(id => id in theirMap);
      if (sharedIds.length < 2) return { score: null, shared: 0 };
      const rankDiffs = sharedIds.map(id => Math.abs(myMap[id] - theirMap[id]));
      const avgSimilarity = 1 - rankDiffs.reduce((a, b) => a + b, 0) / rankDiffs.length;
      const overlapRatio = sharedIds.length / Math.min(myList.length, theirList.length);
      const score = (avgSimilarity * 0.6 + Math.min(overlapRatio, 1) * 0.4) * 100;
      return { score: Math.round(score), shared: sharedIds.length };
    }

    function computeCompatibility(myMovies, myTv, theirMovies, theirTv) {
      const movieResult = computeListCompatibility(myMovies, theirMovies);
      const tvResult = computeListCompatibility(myTv, theirTv);
      const movieShared = movieResult ? movieResult.shared : 0;
      const tvShared = tvResult ? tvResult.shared : 0;
      const totalShared = movieShared + tvShared;
      if (totalShared < 2) return null;
      const movieScore = movieResult && movieResult.score !== null ? movieResult.score : 0;
      const tvScore = tvResult && tvResult.score !== null ? tvResult.score : 0;
      const blended = (movieScore * movieShared + tvScore * tvShared) / totalShared;
      return Math.round(blended);
    }

    async function loadCommunityProfiles() {
      if (!db) return [];
      try {
        const snap = await db.collection("profiles")
          .orderBy("updatedAt", "desc")
          .limit(50)
          .get();
        const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
          .filter(p => (p.movieCount || 0) > 0 || (p.tvShowCount || 0) > 0);
        // Deduplicate by displayName — keep the one with the most rankings (likely the real account)
        const byName = new Map();
        all.forEach(p => {
          const name = (p.displayName || "").toLowerCase().trim();
          const existing = byName.get(name);
          const total = (p.movieCount || 0) + (p.tvShowCount || 0);
          const existingTotal = existing ? (existing.movieCount || 0) + (existing.tvShowCount || 0) : 0;
          if (!existing || total > existingTotal) {
            byName.set(name, p);
          }
        });
        return Array.from(byName.values());
      } catch (e) {
        console.error("Failed to load community:", e);
        return [];
      }
    }

    // ─── Recommendations ────────────────────────────────────────
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const POPULAR_MOVIE_IDS = [278,155,13,550,27205,603,680,329,597,98,862,8587,12,105,76341,157336,872585,361743,545611,496243,475557,346698,693134,533535,402431,299534,299536,24428,1726,118340,284054,293660,263115,324857,634649,414906,109445,277834,354912,301528,10681,585,38,37799,106646,562,949,807,274,769,500,115,578,694,348,679,62,85,10193,14160,9806,2062,244786,1124,77,6977,24,73,7345,210577,335984,78,37165,68718,16869,424,424694,332562,419430,530915,374720,313369];
    const POPULAR_TV_IDS = [1396,1399,66732,1418,60735,456,1402,1668,63174,71446,82856,76479,1100,95557,84958,2316,94997,93405,60574,62560,87108,85552,100088,114472,71712,44217,1405,63926,31917,67744,69478,32726,4614,1434,2190,1622,246,84773,1395,1104,2382,72879,61889,96677,2734,61175,4607,68507,75006,71789];

    // TMDB genre IDs for discover endpoint
    const TMDB_GENRE_IDS = { Horror: 27, Animation: 16, Comedy: 35, Romance: 10749, Drama: 18, Action: 28, "Sci-Fi": 878, Thriller: 53 };
    const TMDB_TV_GENRE_IDS = { Drama: 18, Comedy: 35, "Sci-Fi & Fantasy": 10765, "Action & Adventure": 10759, Animation: 16, Crime: 80 };

    // Fetch fresh unranked movies/shows from TMDB for a category
    function parseTMDBResults(results, genreMap, isTV) {
      return (results || []).map(function(m) {
        return {
          id: m.id,
          title: isTV ? m.name : m.title,
          year: ((isTV ? m.first_air_date : m.release_date) || "").slice(0, 4),
          genre: m.genre_ids && m.genre_ids.length ? (genreMap[m.genre_ids[0]] || "Drama") : "Drama",
          poster: m.poster_path || null,
          rating: m.vote_average || null,
        };
      }).filter(function(m) { return m.poster && m.title; });
    }

    async function fetchTMDBCategory(endpoint, rankedIds, genreMap, isTV, limit) {
      try {
        // Fetch 2 pages for initial variety
        const [r1, r2] = await Promise.all([
          fetch(endpoint + "&page=1").then(r => r.json()),
          fetch(endpoint + "&page=2").then(r => r.json()),
        ]);
        var totalPages = r1.total_pages || 1;
        const all = parseTMDBResults([].concat(r1.results || [], r2.results || []), genreMap, isTV);
        // Dedupe
        const seen = new Set();
        const unique = all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
        // Unranked first, then ranked
        const unranked = unique.filter(m => !rankedIds.has(m.id));
        const ranked = unique.filter(m => rankedIds.has(m.id));
        return { movies: [...unranked, ...ranked].slice(0, limit || 20), totalPages: totalPages, nextPage: 3 };
      } catch (e) { return { movies: [], totalPages: 0, nextPage: 3 }; }
    }

    async function fetchTMDBPage(endpoint, page, genreMap, isTV, existingIds) {
      try {
        var r = await fetch(endpoint + "&page=" + page).then(function(r) { return r.json(); });
        var items = parseTMDBResults(r.results, genreMap, isTV);
        // Dedupe against existing
        var fresh = items.filter(function(m) { return !existingIds.has(m.id); });
        return { movies: fresh, totalPages: r.total_pages || 1 };
      } catch (e) { return { movies: [], totalPages: 0 }; }
    }

    function Recommendations({ onSelect, onBookmark, rankedIds, watchlistIds, rankedList, localDb, mode }) {
      const isTV = mode === "tv";
      const [tmdbCats, setTmdbCats] = useState({});
      const [expandedCat, setExpandedCat] = useState(null);
      const rankedCountRef = useRef(0);
      const endpointsRef = useRef({});

      // Fetch fresh TMDB data for all categories
      useEffect(() => {
        if (!TMDB_API_KEY) return;
        const base = "https://api.themoviedb.org/3";
        const type = isTV ? "tv" : "movie";
        const gMap = isTV ? TV_GENRE_MAP : GENRE_MAP;
        const gIds = isTV ? TMDB_TV_GENRE_IDS : TMDB_GENRE_IDS;

        const genre1 = isTV ? "Drama" : "Horror";
        const genre2 = isTV ? "Comedy" : "Animation";

        const endpoints = {
          popular: `${base}/${type}/popular?api_key=${TMDB_API_KEY}&language=en-US`,
          acclaimed: `${base}/${type}/top_rated?api_key=${TMDB_API_KEY}&language=en-US`,
          newReleases: `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&${isTV ? "first_air_date.gte" : "primary_release_date.gte"}=${NEW_RELEASE_YEAR}-01-01`,
          genre1: `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&with_genres=${gIds[genre1] || 18}`,
          genre2: `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&with_genres=${gIds[genre2] || 16}`,
          genre3: isTV
            ? `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&with_genres=${gIds["Sci-Fi & Fantasy"] || 10765}`
            : `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&with_genres=35`,
          genre4: isTV
            ? null
            : `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&with_genres=10749`,
          classics: `${base}/discover/${type}?api_key=${TMDB_API_KEY}&language=en-US&sort_by=vote_count.desc&${isTV ? "first_air_date.lte" : "primary_release_date.lte"}=${isTV ? "2005" : "1990"}-12-31`,
        };

        // Fetch "For You" using TMDB's similar movies/shows for your top picks
        var forYouEndpoint = null;
        let forYouPromise = Promise.resolve({ movies: [], totalPages: 0, nextPage: 3 });
        if (rankedList && rankedList.length >= 3) {
          // Pick up to 5 top-ranked movies with real TMDB IDs
          var topPicks = rankedList.slice(0, 10).filter(function(m) {
            return typeof m.id === "number" || (typeof m.id === "string" && m.id.indexOf("custom_") !== 0);
          }).slice(0, 5);

          if (topPicks.length > 0) {
            // Fetch similar movies for each top pick in parallel
            var similarPromises = topPicks.map(function(m) {
              var url = base + "/" + type + "/" + m.id + "/similar?api_key=" + TMDB_API_KEY + "&language=en-US&page=1";
              return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
                return parseTMDBResults(data.results || [], gMap, isTV);
              }).catch(function() { return []; });
            });

            forYouPromise = Promise.all(similarPromises).then(function(results) {
              // Merge all similar results, dedupe, prioritize unranked
              var seen = new Set();
              var all = [];
              results.forEach(function(movies) {
                movies.forEach(function(m) {
                  if (!seen.has(m.id) && m.poster) {
                    seen.add(m.id);
                    all.push(m);
                  }
                });
              });
              var unranked = all.filter(function(m) { return !rankedIds.has(m.id); });
              var ranked = all.filter(function(m) { return rankedIds.has(m.id); });
              var movies = unranked.concat(ranked).slice(0, 40);
              return { movies: movies, totalPages: 1, nextPage: 2 };
            });
          } else {
            // Fallback to genre-based discover if no valid TMDB IDs
            var topHalf = rankedList.slice(0, Math.ceil(rankedList.length / 2));
            var genreCounts = {};
            topHalf.forEach(function(m) { if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1; });
            var topGenre = Object.entries(genreCounts).sort(function(a, b) { return b[1] - a[1]; })[0];
            if (topGenre) {
              var topGenreId = gIds[topGenre[0]];
              if (topGenreId) {
                forYouEndpoint = base + "/discover/" + type + "?api_key=" + TMDB_API_KEY + "&language=en-US&sort_by=vote_average.desc&vote_count.gte=100&with_genres=" + topGenreId;
                forYouPromise = fetchTMDBCategory(forYouEndpoint, rankedIds, gMap, isTV, 20);
              }
            }
          }
        }

        // Store endpoints for pagination
        endpointsRef.current = Object.assign({}, endpoints, { forYou: forYouEndpoint, _gMap: gMap, _isTV: isTV });

        var emptyResult = { movies: [], totalPages: 0, nextPage: 3 };
        Promise.all([
          forYouPromise,
          fetchTMDBCategory(endpoints.popular, rankedIds, gMap, isTV, 20),
          fetchTMDBCategory(endpoints.acclaimed, rankedIds, gMap, isTV, 20),
          fetchTMDBCategory(endpoints.newReleases, rankedIds, gMap, isTV, 20),
          fetchTMDBCategory(endpoints.genre1, rankedIds, gMap, isTV, 15),
          fetchTMDBCategory(endpoints.genre2, rankedIds, gMap, isTV, 15),
          fetchTMDBCategory(endpoints.genre3, rankedIds, gMap, isTV, 15),
          endpoints.genre4 ? fetchTMDBCategory(endpoints.genre4, rankedIds, gMap, isTV, 15) : Promise.resolve(emptyResult),
          fetchTMDBCategory(endpoints.classics, rankedIds, gMap, isTV, 15),
        ]).then(function(results) {
          var keys = ["forYou", "popular", "acclaimed", "newReleases", "g1", "g2", "g3", "g4", "classics"];
          var epKeys = ["forYou", "popular", "acclaimed", "newReleases", "genre1", "genre2", "genre3", "genre4", "classics"];
          var state = {};
          keys.forEach(function(k, i) {
            var r = results[i];
            state[k] = { movies: r.movies, totalPages: r.totalPages, nextPage: r.nextPage, loading: false, endpoint: endpointsRef.current[epKeys[i]] || null };
          });
          setTmdbCats(state);
        });

        rankedCountRef.current = rankedIds.size;
      }, [isTV, rankedIds.size]);

      // Close expanded view on Escape
      useEffect(function() {
        function handleKey(e) { if (e.key === "Escape") setExpandedCat(null); }
        document.addEventListener("keydown", handleKey);
        return function() { document.removeEventListener("keydown", handleKey); };
      }, []);

      // Load more movies for a category (with throttle)
      var loadThrottleRef = useRef({});
      function loadMoreMovies(catKey) {
        var now = Date.now();
        if (loadThrottleRef.current[catKey] && now - loadThrottleRef.current[catKey] < 800) return;
        loadThrottleRef.current[catKey] = now;

        var catData = tmdbCats[catKey];
        if (!catData || !catData.endpoint || catData.loading) return;
        if (catData.nextPage > catData.totalPages) return;
        var ep = endpointsRef.current;
        var gMap = ep._gMap;
        var tvMode = ep._isTV;

        // Capture what we need before async work
        var endpoint = catData.endpoint;
        var pageToFetch = catData.nextPage;

        // Set loading
        setTmdbCats(function(prev) {
          var updated = Object.assign({}, prev);
          updated[catKey] = Object.assign({}, updated[catKey], { loading: true });
          return updated;
        });

        // Build existingIds from fresh state inside the updater callback
        var existingIds = new Set((catData.movies || []).map(function(m) { return m.id; }));
        fetchTMDBPage(endpoint, pageToFetch, gMap, tvMode, existingIds).then(function(result) {
          setTmdbCats(function(prev) {
            var old = prev[catKey];
            if (!old) return prev;
            // Dedupe against current state (not stale closure)
            var currentIds = new Set(old.movies.map(function(m) { return m.id; }));
            var fresh = result.movies.filter(function(m) { return !currentIds.has(m.id); });
            var updated = Object.assign({}, prev);
            updated[catKey] = Object.assign({}, old, {
              movies: old.movies.concat(fresh),
              nextPage: old.nextPage + 1,
              totalPages: result.totalPages || old.totalPages,
              loading: false,
            });
            return updated;
          });
        });
      }

      // Helper to get movies array from tmdbCats (handles new structure)
      function getTmdbMovies(key) {
        var d = tmdbCats[key];
        if (!d) return [];
        return d.movies || d;
      }

      const categories = useMemo(() => {
        const db = localDb;
        const genre1 = isTV ? "Drama" : "Horror";
        const genre2 = isTV ? "Comedy" : "Animation";
        const genre3Label = isTV ? "Sci-Fi & Fantasy" : "Comedy";
        const genre4Label = isTV ? null : "Romance";
        const forYouTitle = isTV ? "Shows You May Like" : "Movies You May Like";

        // Helper: merge local DB results with TMDB results, preferring unranked
        // localLimit caps how many local DB items to include (prevents dumping thousands)
        function mergeResults(localItems, tmdbItems, localLimit) {
          var maxLocal = localLimit || 10;
          var localUnranked = localItems.filter(m => !rankedIds.has(m.id)).slice(0, maxLocal);
          const merged = new Map();
          localUnranked.forEach(m => merged.set(m.id, m));
          (tmdbItems || []).filter(m => !rankedIds.has(m.id)).forEach(m => { if (!merged.has(m.id)) merged.set(m.id, m); });
          // Fill with ranked only if very few results
          if (merged.size < 5) {
            localItems.filter(m => rankedIds.has(m.id)).slice(0, 5).forEach(m => { if (!merged.has(m.id)) merged.set(m.id, m); });
            (tmdbItems || []).filter(m => rankedIds.has(m.id)).forEach(m => { if (!merged.has(m.id)) merged.set(m.id, m); });
          }
          return [...merged.values()];
        }

        const popularIds = isTV ? POPULAR_TV_IDS : POPULAR_MOVIE_IDS;
        const popularIdSet = new Set(popularIds);

        const cats = [];

        // For You
        const localForYou = rankedList && rankedList.length >= 3 ? (() => {
          const topHalf = rankedList.slice(0, Math.ceil(rankedList.length / 2));
          const genreCounts = {};
          const decadeCounts = {};
          topHalf.forEach(m => {
            if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1;
            const decade = Math.floor(parseInt(m.year) / 10) * 10;
            if (decade) decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
          });
          const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
          const topDecades = Object.entries(decadeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => Number(e[0]));
          return db.filter(m => !rankedIds.has(m.id) && (topGenres.includes(m.genre) || topDecades.includes(Math.floor(parseInt(m.year) / 10) * 10)));
        })() : [];
        const forYou = mergeResults(localForYou, getTmdbMovies("forYou"));
        if (forYou.length > 0) cats.push({ title: forYouTitle, catKey: "forYou", movies: forYou });

        // Popular
        cats.push({ title: "Popular", catKey: "popular", movies: mergeResults(db.filter(m => popularIdSet.has(m.id)), getTmdbMovies("popular")) });

        // Critically Acclaimed
        const localAcclaimed = db.filter(m => m.rating && m.rating >= 8.0);
        const acclaimedMerged = mergeResults(localAcclaimed, getTmdbMovies("acclaimed"));
        if (acclaimedMerged.length > 0) cats.push({ title: "\ud83c\udfc6 Critically Acclaimed", catKey: "acclaimed", movies: acclaimedMerged });

        // New Releases
        cats.push({ title: "New Releases", catKey: "newReleases", movies: mergeResults(db.filter(m => parseInt(m.year) >= NEW_RELEASE_YEAR), getTmdbMovies("newReleases")) });

        // Genre rows
        cats.push({ title: genre1, catKey: "g1", movies: mergeResults(db.filter(m => m.genre === genre1), getTmdbMovies("g1")) });
        cats.push({ title: genre2, catKey: "g2", movies: mergeResults(db.filter(m => m.genre === genre2), getTmdbMovies("g2")) });
        cats.push({ title: genre3Label, catKey: "g3", movies: mergeResults(
          isTV ? db.filter(m => m.genre === "Sci-Fi & Fantasy") : db.filter(m => m.genre === "Comedy"),
          getTmdbMovies("g3")
        ) });
        if (genre4Label) {
          cats.push({ title: genre4Label, catKey: "g4", movies: mergeResults(db.filter(m => m.genre === "Romance"), getTmdbMovies("g4")) });
        }

        // Classics
        const classicYear = isTV ? 2005 : 1990;
        cats.push({ title: "Classics", catKey: "classics", movies: mergeResults(db.filter(m => parseInt(m.year) <= classicYear), getTmdbMovies("classics")) });

        return cats;
      }, [localDb, isTV, tmdbCats, rankedIds.size, rankedList && rankedList.length >= 3 ? rankedList.slice(0, Math.ceil(rankedList.length / 2)).map(m => m.id).join(",") : ""]);

      // Render a single movie card (shared between row and expanded grid)
      function renderCard(m) {
        var isRanked = rankedIds.has(m.id);
        var isWatchlisted = watchlistIds && watchlistIds.has(m.id);
        return (
          <div key={m.id} className={"rec-card" + (isRanked ? " ranked" : "")}
            onClick={function() { if (!isRanked && !isWatchlisted) { setExpandedCat(null); onSelect(m); } }}>
            {isRanked && <div className="rec-card-badge">Ranked</div>}
            {isWatchlisted && <div className="rec-card-badge" style={{background:"rgba(245,197,24,0.9)"}}>&#x2605;</div>}
            <Poster poster={m.poster} title={m.title}
              style={{ width: "100%", height: "auto", aspectRatio: "2/3", borderRadius: 8 }} />
            <div className="rec-card-title">{m.title}</div>
            <div className="rec-card-year">{m.year}</div>
          </div>
        );
      }

      // Track how many cards each row shows (start small, grow on scroll)
      var ROW_INITIAL = 20;
      var ROW_STEP = 20;
      var [rowLimits, setRowLimits] = useState({});

      function getRowLimit(catKey) {
        return rowLimits[catKey] || ROW_INITIAL;
      }

      function expandRowLimit(catKey) {
        setRowLimits(function(prev) {
          var cur = prev[catKey] || ROW_INITIAL;
          var updated = Object.assign({}, prev);
          updated[catKey] = cur + ROW_STEP;
          return updated;
        });
      }

      // Handle horizontal scroll to load more
      function handleRowScroll(e, catKey) {
        var el = e.target;
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 300) {
          // First expand the rendered window
          var limit = getRowLimit(catKey);
          var catData = tmdbCats[catKey];
          var totalAvailable = 0;
          for (var ci = 0; ci < categories.length; ci++) {
            if (categories[ci].catKey === catKey) { totalAvailable = categories[ci].movies.length; break; }
          }
          if (limit < totalAvailable) {
            expandRowLimit(catKey);
          } else {
            // Already showing all available, fetch more from TMDB
            loadMoreMovies(catKey);
          }
        }
      }

      // Handle expanded grid scroll to load more
      function handleGridScroll(e, catKey) {
        var el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
          loadMoreMovies(catKey);
        }
      }

      // Get fresh category from categories array (avoids stale expandedCat reference)
      var freshExpandedCat = expandedCat ? categories.find(function(c) { return c.catKey === expandedCat.catKey; }) || expandedCat : null;

      // Get all movies for expanded view (merged fresh category + all TMDB pages)
      function getExpandedMovies() {
        if (!freshExpandedCat) return [];
        var tmdbData = tmdbCats[freshExpandedCat.catKey];
        var tmdbMovies = tmdbData ? (tmdbData.movies || []) : [];
        var seen = new Set(freshExpandedCat.movies.map(function(m) { return m.id; }));
        var extra = tmdbMovies.filter(function(m) { return !seen.has(m.id); });
        return freshExpandedCat.movies.concat(extra);
      }

      var expandedTmdbData = freshExpandedCat ? tmdbCats[freshExpandedCat.catKey] : null;
      var isLoadingExpanded = expandedTmdbData && expandedTmdbData.loading;
      var hasMoreExpanded = expandedTmdbData && expandedTmdbData.nextPage <= expandedTmdbData.totalPages;

      return (
        <div className="recs-section">
          {categories.map(function(cat) {
            var catLoading = tmdbCats[cat.catKey] && tmdbCats[cat.catKey].loading;
            var limit = getRowLimit(cat.catKey);
            var visibleMovies = cat.movies.slice(0, limit);
            return (
              <div key={cat.title} className="recs-category">
                <div className="recs-category-title" onClick={function() { setExpandedCat(cat); loadMoreMovies(cat.catKey); }}>
                  {cat.title} <span className="expand-hint">See all &rsaquo;</span>
                </div>
                <div className="recs-row" onScroll={function(e) { handleRowScroll(e, cat.catKey); }}>
                  {visibleMovies.map(renderCard)}
                  {catLoading && <div className="recs-row-loader"><div className="recs-spinner"></div></div>}
                </div>
              </div>
            );
          })}

          {freshExpandedCat && (
            <div className="expanded-cat-overlay" onClick={function() { setExpandedCat(null); }}>
              <div className="expanded-cat-modal" onClick={function(e) { e.stopPropagation(); }}>
                <div className="expanded-cat-header">
                  <h2>{freshExpandedCat.title}</h2>
                  <button className="expanded-cat-close" onClick={function() { setExpandedCat(null); }}>&times;</button>
                </div>
                <div className="expanded-cat-grid" onScroll={function(e) { handleGridScroll(e, freshExpandedCat.catKey); }}>
                  {getExpandedMovies().map(renderCard)}
                  {isLoadingExpanded && <div className="expanded-cat-loader"><div className="recs-spinner"></div></div>}
                  {!isLoadingExpanded && !hasMoreExpanded && <div className="expanded-cat-end">That's all!</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── Search Bar ─────────────────────────────────────────────
    function SearchBar({ onSelect, onBookmark, onRerank, rankedIds, watchlistIds, localDb, searchFn, placeholder, customLabel, dupeLabel }) {
      const [query, setQuery] = useState("");
      const [open, setOpen] = useState(false);
      const [tmdbResults, setTmdbResults] = useState([]);
      const [searching, setSearching] = useState(false);
      const containerRef = useRef(null);
      const debounceRef = useRef(null);

      // Local results (instant)
      const localResults = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return (localDb || MOVIE_DB).filter(m =>
          m.title.toLowerCase().includes(q) || m.year.includes(q) || m.genre.toLowerCase().includes(q)
        ).slice(0, 10);
      }, [query, localDb]);

      // TMDB live search (debounced)
      const activeFn = searchFn || searchTMDB;
      useEffect(() => {
        if (!TMDB_API_KEY || !query.trim() || query.trim().length < 2) {
          setTmdbResults([]); setSearching(false); return;
        }
        setSearching(true);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
          const results = await activeFn(query.trim());
          setTmdbResults(results);
          setSearching(false);
        }, 350);
        return () => clearTimeout(debounceRef.current);
      }, [query, activeFn]);

      // Merge: local first, then TMDB results not already in local
      const results = useMemo(() => {
        const localIds = new Set(localResults.map(m => m.id));
        const extra = tmdbResults.filter(m => !localIds.has(m.id));
        return [...localResults, ...extra].slice(0, 15);
      }, [localResults, tmdbResults]);

      useEffect(() => { setOpen(results.length > 0 || query.trim().length > 0); }, [results, query]);

      useEffect(() => {
        function handleClick(e) {
          if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
      }, []);

      function handleSelect(movie) {
        if (rankedIds.has(movie.id)) {
          if (onRerank) { setQuery(""); setOpen(false); onRerank(movie); }
          return;
        }
        setQuery(""); setOpen(false); onSelect(movie);
      }

      function handleAddCustom() {
        const title = query.trim();
        if (!title) return;
        setQuery(""); setOpen(false);
        onSelect({ id: "custom_" + Date.now(), title, year: "", genre: "", poster: null });
      }

      return (
        <div className="search-section" ref={containerRef}>
          <input className="search-input" type="text" placeholder={placeholder || "Search for a movie to rank..."}
            value={query} onChange={e => setQuery(e.target.value)}
            onFocus={() => query.trim() && setOpen(true)} />
          {open && (
            <div className="search-results">
              {results.map(m => {
                const isDupe = rankedIds.has(m.id);
                return (
                  <div key={m.id} className="search-item" style={isDupe && !onRerank ? { opacity: 0.5 } : {}}
                    onClick={() => handleSelect(m)}>
                    <Poster poster={m.poster} title={m.title} className="search-item-poster" />
                    <div className="search-item-info">
                      <div className="search-item-title">{m.title}</div>
                      <div className="search-item-year">{m.year} &middot; {m.genre}</div>
                    </div>
                    {isDupe && onRerank && <span className="search-item-dupe" style={{color:"var(--accent)", cursor:"pointer"}}>Re-rank ↻</span>}
                    {isDupe && !onRerank && <span className="search-item-dupe">{dupeLabel || "Already ranked"}</span>}
                    {onBookmark && !isDupe && (
                      <button className={`bookmark-btn ${watchlistIds && watchlistIds.has(m.id) ? "bookmarked" : ""}`}
                        disabled={watchlistIds && watchlistIds.has(m.id)}
                        onClick={(e) => { e.stopPropagation(); onBookmark(m); }}
                        title={watchlistIds && watchlistIds.has(m.id) ? "On watchlist" : "Add to watchlist"}>
                        {watchlistIds && watchlistIds.has(m.id) ? "\u2605" : "\u2606"}
                      </button>
                    )}
                  </div>
                );
              })}
              {searching && <div style={{textAlign:"center",padding:"10px",color:"var(--text-muted)",fontSize:"0.85rem"}}>Searching TMDB...</div>}
              {query.trim() && (
                <div className="search-add-custom" onClick={handleAddCustom}>
                  <div className="search-add-icon">+</div>
                  <div>Add "{query.trim()}" as custom {customLabel || "movie"}</div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // ─── Comparison View ────────────────────────────────────────
    function ComparisonView({ session, onChoice, onCancel, onWatchlist, onSkip, itemLabel }) {
      const [picked, setPicked] = useState(null);
      useEffect(() => { setPicked(null); }, [session && session.step, session && session.newMovie && session.newMovie.id]);
      useEffect(() => {
        if (!session || session.done) return;
        function handleKey(e) { if (e.key === "Escape") onCancel(); }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
      }, [session]);
      if (!session || session.done) return null;
      const { newMovie, compareMovie, step, maxSteps } = session;

      var compareScore;
      if (session.phase === 1) {
        const globalMid = globalIndexOf(session.list, session.genreList[session.mid]);
        compareScore = globalMid >= 0 ? getScore(globalMid, session.list.length) : undefined;
      } else {
        compareScore = getScore(session.mid, session.list.length);
      }

      function handleChoice(isNew) {
        if (picked) return;
        setPicked(isNew ? "new" : "compare");
        setTimeout(() => onChoice(isNew), 200);
      }

      function Card({ movie, onClick, score, pickedState }) {
        var klass = "comparison-card";
        if (pickedState === "winner") klass += " is-winning";
        else if (pickedState === "loser") klass += " is-losing";
        return (
          <div className={klass} onClick={onClick}>
            <Poster poster={movie.poster} title={movie.title} size="lg" />
            <div className="comparison-card-info">
              <div className="comparison-card-title">{movie.title}</div>
              <div className="comparison-card-year">
                {movie.year}{movie.genre ? ` \u00b7 ${movie.genre}` : ""}
                {score !== undefined && (
                  <span className={`score-badge ${scoreClass(score)}`} style={{marginLeft: 8, fontSize: "0.7rem", padding: "2px 6px"}}>
                    {score.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="comparison-label">I prefer this</div>
            </div>
          </div>
        );
      }

      const totalCells = Math.max(maxSteps, 1);
      const currentCell = Math.min(step, totalCells - 1);
      const stripCells = [];
      for (var sc = 0; sc < totalCells; sc++) {
        var cellClass = "comparison-strip-cell";
        if (sc < step) cellClass += " filled";
        if (sc === currentCell) cellClass += " current";
        stripCells.push(<span key={sc} className={cellClass} />);
      }

      return (
        <div className="comparison-overlay">
          <div className="comparison-box">
            <div className="comparison-title">Which {itemLabel || "movie"} do you prefer?</div>
            <div className="comparison-strip" role="progressbar"
              aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={totalCells}
              aria-label={`Comparison ${step + 1} of ~${totalCells}`}>
              {stripCells}
            </div>
            <div className="comparison-strip-text">Comparison {step + 1} / ~{totalCells}</div>
            {session.phase === 1 && (
              <div style={{fontSize:"0.72rem", color:"var(--text-muted)", marginTop:2}}>
                Finding rank among {newMovie.genre} movies\u2026
              </div>
            )}
            {session.phase === 2 && (
              <div style={{fontSize:"0.72rem", color:"var(--text-muted)", marginTop:2}}>
                Pinpointing exact position\u2026
              </div>
            )}
            <div className="comparison-cards">
              <Card movie={newMovie} onClick={() => handleChoice(true)}
                pickedState={picked === "new" ? "winner" : picked === "compare" ? "loser" : null} />
              <Card movie={compareMovie} onClick={() => handleChoice(false)} score={compareScore}
                pickedState={picked === "compare" ? "winner" : picked === "new" ? "loser" : null} />
            </div>
            <div style={{display:"flex",gap:"8px",justifyContent:"center",marginTop:"16px",flexWrap:"wrap"}}>
              {onWatchlist && (
                <button className="comparison-cancel" onClick={onWatchlist}
                  style={{borderColor:"var(--gold)",color:"var(--gold)",marginTop:0}}>
                  &#x2606; Add to Watchlist
                </button>
              )}
              {onSkip && (
                <button className="comparison-cancel" onClick={onSkip}
                  style={{borderColor:"var(--accent)",color:"var(--accent)",marginTop:0}}>
                  &#x1F3B2; Can't Decide
                </button>
              )}
              <button className="comparison-cancel" onClick={onCancel} style={{marginTop:0}}>Cancel</button>
            </div>
          </div>
        </div>
      );
    }

    // ─── Ranked List (with optional read-only mode) ─────────────
    function RankedList({ list, onRemove, onClear, onShare, onShareCard, onMove, readOnly, user, onAddMovie, onBookmark, rankedIds, watchlistIds, itemLabel, onMovieClick, isPrivate, onTogglePrivate, onImport, onUndoImport }) {
      const [confirmClear, setConfirmClear] = useState(false);
      const [confirmUndo, setConfirmUndo] = useState(false);
      const [genreFilter, setGenreFilter] = useState(null);
      const [dragIndex, setDragIndex] = useState(null);
      const [overIndex, setOverIndex] = useState(null);
      const [rankShowAll, setRankShowAll] = useState(false);
      const RANK_INITIAL_LIMIT = 50;
      const listRef = useRef(null);
      const isDraggingRef = useRef(false);
      const startPosRef = useRef({ x: 0, y: 0, index: null });
      const cloneRef = useRef(null);
      const scrollIntervalRef = useRef(null);
      const itemRectsRef = useRef([]);
      const lastClientYRef = useRef(0);
      const total = list.length;
      const indexMap = useMemo(() => { var m = new Map(); list.forEach(function(movie, idx) { m.set(movie.id, idx); }); return m; }, [list]);
      const genres = useMemo(() => [...new Set(list.map(m => m.genre).filter(Boolean))].sort(), [list]);
      const filteredList = genreFilter ? list.filter(m => m.genre === genreFilter) : list;
      const displayList = (!rankShowAll && filteredList.length > RANK_INITIAL_LIMIT) ? filteredList.slice(0, RANK_INITIAL_LIMIT) : filteredList;
      const hasMoreRanked = filteredList.length > RANK_INITIAL_LIMIT && !rankShowAll;

      useEffect(() => {
        return () => {
          if (cloneRef.current) { cloneRef.current.remove(); cloneRef.current = null; }
          if (scrollIntervalRef.current) { clearInterval(scrollIntervalRef.current); scrollIntervalRef.current = null; }
        };
      }, []);

      function computeOverIndex(clientY) {
        if (!listRef.current) return null;
        var listTop = listRef.current.getBoundingClientRect().top;
        var relY = clientY - listTop + listRef.current.scrollTop;
        var rects = itemRectsRef.current;
        for (var r = 0; r < rects.length; r++) {
          var mid = rects[r].top + rects[r].height / 2;
          if (relY < mid) return r;
        }
        return rects.length;
      }

      function startAutoScroll(clientY) {
        if (scrollIntervalRef.current) return;
        scrollIntervalRef.current = setInterval(function() {
          var y = lastClientYRef.current;
          var edge = 60;
          if (y < edge) {
            var speed = Math.round(2 + 6 * (1 - y / edge));
            window.scrollBy(0, -speed);
          } else if (y > window.innerHeight - edge) {
            var dist = y - (window.innerHeight - edge);
            var speed2 = Math.round(2 + 6 * (dist / edge));
            window.scrollBy(0, speed2);
          }
        }, 16);
      }

      function stopAutoScroll() {
        if (scrollIntervalRef.current) { clearInterval(scrollIntervalRef.current); scrollIntervalRef.current = null; }
      }

      function removeClone() {
        if (cloneRef.current) { cloneRef.current.remove(); cloneRef.current = null; }
      }

      function handleDragStart(e, index) {
        if (e.target.closest && e.target.closest("button")) return;
        startPosRef.current = { x: e.clientX, y: e.clientY, index: index };
        isDraggingRef.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }

      function handleDragMove(e) {
        var sp = startPosRef.current;
        if (sp.index === null) return;

        if (!isDraggingRef.current) {
          var dx = Math.abs(e.clientX - sp.x);
          var dy = Math.abs(e.clientY - sp.y);
          if (dx + dy < 5) return;
          isDraggingRef.current = true;
          setDragIndex(sp.index);

          // Cache item rects relative to list container
          if (listRef.current) {
            var items = listRef.current.querySelectorAll(".ranked-item");
            var listTop = listRef.current.getBoundingClientRect().top;
            itemRectsRef.current = Array.from(items).map(function(el) {
              var r = el.getBoundingClientRect();
              return { top: r.top - listTop + listRef.current.scrollTop, height: r.height };
            });
          }

          // Create floating clone
          var items2 = listRef.current.querySelectorAll(".ranked-item");
          var srcEl = items2[sp.index];
          if (srcEl) {
            var rect = srcEl.getBoundingClientRect();
            var clone = srcEl.cloneNode(true);
            clone.style.cssText = "position:fixed;z-index:9999;pointer-events:none;width:" +
              rect.width + "px;left:" + rect.left + "px;top:" + rect.top + "px;opacity:0.92;" +
              "box-shadow:0 8px 32px rgba(0,0,0,0.35);transform:scale(1.02);border-radius:14px;" +
              "transition:none;background:var(--surface);border:1px solid var(--accent);";
            document.body.appendChild(clone);
            cloneRef.current = clone;
            startPosRef.current.offsetY = e.clientY - rect.top;
          }
          startAutoScroll(e.clientY);
        }

        if (isDraggingRef.current) {
          lastClientYRef.current = e.clientY;
          if (cloneRef.current) {
            cloneRef.current.style.top = (e.clientY - (startPosRef.current.offsetY || 0)) + "px";
          }
          var newOver = computeOverIndex(e.clientY);
          setOverIndex(function(prev) { return newOver !== prev ? newOver : prev; });
        }
      }

      function handleDragEnd(e) {
        if (isDraggingRef.current && startPosRef.current.index !== null && onMove) {
          var fromDisplay = startPosRef.current.index;
          var toDisplay = overIndex;
          if (toDisplay !== null && toDisplay !== fromDisplay && toDisplay !== fromDisplay + 1) {
            var draggedId = displayList[fromDisplay].id;
            var beforeId = null;
            if (toDisplay < displayList.length) {
              var idx = toDisplay;
              if (idx === fromDisplay) idx++;
              if (idx < displayList.length) {
                beforeId = displayList[idx].id;
              }
            } else if (displayList.length < filteredList.length) {
              // List is truncated ("Show all" collapsed): dropping below the last
              // visible item should land right there, not at the end of the full list
              beforeId = filteredList[displayList.length].id;
            }
            onMove(draggedId, beforeId);
          }
        }
        removeClone();
        stopAutoScroll();
        setDragIndex(null);
        setOverIndex(null);
        isDraggingRef.current = false;
        startPosRef.current = { x: 0, y: 0, index: null };
      }

      function handleDragCancel(e) {
        removeClone();
        stopAutoScroll();
        setDragIndex(null);
        setOverIndex(null);
        isDraggingRef.current = false;
        startPosRef.current = { x: 0, y: 0, index: null };
      }

      if (total === 0 && !readOnly) {
        return (
          <div className="ranked-section">
            <h2 style={{ marginBottom: 16 }}>Your Rankings</h2>
            <div className="ranked-empty">
              <p>{itemLabel === "TV show" ? "\uD83D\uDCFA" : "\uD83C\uDFAC"}</p>
              <p>Search or pick a {itemLabel || "movie"} above to start ranking!</p>
            </div>
          </div>
        );
      }

      if (total === 0 && readOnly) {
        return (
          <div className="ranked-section">
            <div className="ranked-empty">
              <p>{itemLabel === "TV show" ? "\uD83D\uDCFA" : "\uD83C\uDFAC"}</p>
              <p>No {itemLabel || "movie"}s ranked yet.</p>
            </div>
          </div>
        );
      }

      return (
        <div className="ranked-section">
          <div className="ranked-header">
            <h2>{readOnly ? "Rankings" : "Your Rankings"} ({genreFilter ? `${filteredList.length} of ${total} \u00b7 ${genreFilter}` : total})</h2>
            {!readOnly && (
              <div className="ranked-header-btns">
                {user && onTogglePrivate && (
                  <button className={`private-toggle ${isPrivate ? "active" : ""}`} onClick={onTogglePrivate}>
                    {isPrivate ? "\uD83D\uDD12" : "\uD83D\uDD13"}
                  </button>
                )}
                {user && onImport && (
                  <button className="share-btn" onClick={onImport}>
                    <span>&#x1F4E5;</span> Import
                  </button>
                )}
                {user && onUndoImport && localStorage.getItem("movi-import-backup") && (Date.now() - parseInt(localStorage.getItem("movi-import-backup-time") || "0")) < 86400000 && (
                  <button className="share-btn" onClick={() => setConfirmUndo(true)} style={{background: "var(--surface2)"}}>
                    <span>&#x21A9;</span> Undo Import
                  </button>
                )}
                {user && onShare && (
                  <button className="share-btn" onClick={onShare}>
                    <span>&#x1F517;</span> Share
                  </button>
                )}
                {onShareCard && list.length > 0 && (
                  <button className="share-btn" onClick={() => onShareCard(list[0])}>
                    <span>&#x1F4E3;</span> Card
                  </button>
                )}
                <button className="clear-btn" onClick={() => setConfirmClear(true)}>Clear All</button>
              </div>
            )}
          </div>
          {genres.length > 1 && (
            <div className="genre-pills">
              <button className={"genre-pill" + (!genreFilter ? " active" : "")} onClick={() => setGenreFilter(null)}>All</button>
              {genres.map(g => (
                <button key={g} className={"genre-pill" + (genreFilter === g ? " active" : "")} onClick={() => setGenreFilter(genreFilter === g ? null : g)}>{g}</button>
              ))}
            </div>
          )}
          <div className={"ranked-list" + (dragIndex !== null ? " is-dragging" : "")} ref={listRef}>
            {displayList.map((movie, displayIdx) => {
              var i = indexMap.has(movie.id) ? indexMap.get(movie.id) : list.indexOf(movie);
              const score = getScore(i, total);
              var itemClass = "ranked-item";
              if (dragIndex === displayIdx) itemClass += " dragging-source";
              if (overIndex === displayIdx && overIndex !== dragIndex && overIndex !== dragIndex + 1) itemClass += " drop-before";
              return (
                <div key={movie.id} className={itemClass} style={{"--score-scale": Math.max(0.04, Math.min(1, score / 10))}}>
                  <div className="ranked-item-tap" onClick={() => onMovieClick && onMovieClick(movie)}>
                    <div className="rank-number">{i + 1}</div>
                    <Poster poster={movie.poster} title={movie.title}
                      className={movie.poster ? "ranked-poster" : "ranked-poster-ph poster-placeholder"} />
                    <div className="ranked-item-info">
                      <div className="ranked-item-title">{movie.title}</div>
                      <div className="ranked-item-year">{movie.year}{movie.genre ? ` \u00b7 ${movie.genre}` : ""}</div>
                    </div>
                    <div className={`score-badge ${scoreClass(score)}`}>{score.toFixed(1)}</div>
                  </div>
                  {!readOnly && onMove && (
                    <div className="drag-handle"
                      onPointerDown={(e) => handleDragStart(e, displayIdx)}
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragCancel}
                      title="Drag to reorder">&#x2807;</div>
                  )}
                  {!readOnly && <button className="remove-btn" onClick={(e) => { e.stopPropagation(); onRemove(movie.id); }} title="Remove">&#x2715;</button>}
                  {onBookmark && (
                    <button className={`bookmark-btn ${watchlistIds && watchlistIds.has(movie.id) ? "bookmarked" : ""}`}
                      disabled={watchlistIds && watchlistIds.has(movie.id) || (rankedIds && rankedIds.has(movie.id))}
                      onClick={(e) => { e.stopPropagation(); onBookmark(movie); }}
                      title={watchlistIds && watchlistIds.has(movie.id) ? "On watchlist" : "Add to watchlist"}>
                      {watchlistIds && watchlistIds.has(movie.id) ? "\u2605" : "\u2606"}
                    </button>
                  )}
                  {onAddMovie && (
                    <button className="profile-add-btn"
                      disabled={rankedIds && rankedIds.has(movie.id)}
                      onClick={(e) => { e.stopPropagation(); onAddMovie(movie); }}
                      title="Add to your rankings">
                      {rankedIds && rankedIds.has(movie.id) ? "Ranked" : "+ Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {hasMoreRanked && (
            <button className="show-more-ranked" onClick={() => setRankShowAll(true)}>
              Show all {filteredList.length} rankings &#x25BC;
            </button>
          )}
          {rankShowAll && filteredList.length > RANK_INITIAL_LIMIT && (
            <button className="show-more-ranked" onClick={() => setRankShowAll(false)}>
              Show less &#x25B2;
            </button>
          )}
          {confirmClear && (
            <div className="confirm-overlay">
              <div className="confirm-box">
                <p>Remove all {total} {itemLabel || "movie"}s from your rankings?</p>
                <div className="confirm-btns">
                  <button className="confirm-yes" onClick={() => { onClear(); setConfirmClear(false); }}>Yes, Clear All</button>
                  <button className="confirm-no" onClick={() => setConfirmClear(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          {confirmUndo && (
            <div className="confirm-overlay">
              <div className="confirm-box">
                <p>Restore your rankings to before the last import?</p>
                <div className="confirm-btns">
                  <button className="confirm-yes" onClick={() => { onUndoImport(); setConfirmUndo(false); }}>Yes, Undo Import</button>
                  <button className="confirm-no" onClick={() => setConfirmUndo(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── Letterboxd Import Modal ─────────────────────────────────
    function LetterboxdImport({ onImport, onClose, existingCount }) {
      const [step, setStep] = useState("upload");
      const [progress, setProgress] = useState({ current: 0, total: 0 });
      const [matched, setMatched] = useState([]);
      const [failed, setFailed] = useState([]);
      const [showFailed, setShowFailed] = useState(false);

      function handleFile(e) {
        var file = e.target.files[0];
        if (!file) return;
        extractLetterboxdRatings(file).then(function(entries) {
          if (entries.length === 0) { alert("No rated movies found in file."); return; }
          setStep("matching");
          setProgress({ current: 0, total: entries.length });
          var matchedMovies = [];
          var failedMovies = [];
          function processNext(i) {
            if (i >= entries.length) {
              matchedMovies.sort(function(a, b) {
                if (b._lbRating !== a._lbRating) return b._lbRating - a._lbRating;
                return (b.rating || 0) - (a.rating || 0);
              });
              setMatched(matchedMovies.slice());
              setStep("results");
              return;
            }
            var entry = entries[i];
            lookupTMDB(entry.title, entry.year).then(function(movie) {
              if (movie) {
                movie._lbRating = entry.lbRating;
                matchedMovies.push(movie);
              } else {
                failedMovies.push(entry.title + (entry.year ? " (" + entry.year + ")" : ""));
              }
              setProgress({ current: i + 1, total: entries.length });
              setMatched(matchedMovies.slice());
              setFailed(failedMovies.slice());
              setTimeout(function() { processNext(i + 1); }, 100);
            });
          }
          processNext(0);
        }).catch(function(err) {
          alert("Error reading file: " + err.message);
        });
      }

      function handleImport(mode) {
        var cleanMovies = matched.map(function(m) {
          return { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, rating: m.rating };
        });
        var withRatings = matched.map(function(m) {
          return { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, rating: m.rating, _lbRating: m._lbRating };
        });
        onImport(cleanMovies, mode, withRatings);
      }

      if (step === "upload") {
        return (
          <div className="import-overlay" onClick={onClose}>
            <div className="import-modal" onClick={function(e) { e.stopPropagation(); }}>
              <h3>Import from Letterboxd</h3>
              <p>Export your Letterboxd data at <strong>letterboxd.com/settings/data</strong>, then upload the ZIP file below.</p>
              <label className="import-file-input">
                {"📁"} Choose ZIP or CSV file
                <input type="file" accept=".zip,.csv" onChange={handleFile}
                  style={{ display: "none" }} />
              </label>
              <div className="import-btns">
                <button className="import-btn import-btn-cancel" onClick={onClose}>Cancel</button>
              </div>
            </div>
          </div>
        );
      }

      if (step === "matching") {
        var pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
        return (
          <div className="import-overlay">
            <div className="import-modal" onClick={function(e) { e.stopPropagation(); }}>
              <h3>Matching movies...</h3>
              <div className="import-progress-bar">
                <div className="import-progress-fill" style={{ width: pct + "%" }}></div>
              </div>
              <div className="import-status">{progress.current} / {progress.total} movies processed</div>
              {failed.length > 0 && (
                <div className="import-status">{matched.length} matched, {failed.length} not found</div>
              )}
            </div>
          </div>
        );
      }

      return (
        <div className="import-overlay" onClick={onClose}>
          <div className="import-modal" onClick={function(e) { e.stopPropagation(); }}>
            <h3>Import Complete</h3>
            <div className="import-results">
              <div className="import-success">Matched {matched.length} of {matched.length + failed.length} movies</div>
              {failed.length > 0 && (
                <div>
                  <button className="import-failed-toggle" onClick={function() { setShowFailed(!showFailed); }}>
                    {showFailed ? "Hide" : "Show"} {failed.length} unmatched {failed.length === 1 ? "movie" : "movies"}
                  </button>
                  {showFailed && (
                    <div className="import-failed-list">
                      {failed.map(function(f, i) { return <div key={i}>{f}</div>; })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {existingCount > 0 ? (
              <div>
                <div className="import-warning">You have {existingCount} existing rankings.</div>
                <div className="import-btns">
                  <button className="import-btn import-btn-primary" onClick={function() { handleImport("replace"); }}>Replace All</button>
                  <button className="import-btn import-btn-secondary" onClick={function() { handleImport("merge"); }}>Merge</button>
                  <button className="import-btn import-btn-cancel" onClick={onClose}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="import-btns">
                <button className="import-btn import-btn-primary" onClick={function() { handleImport("replace"); }}>Import {matched.length} Movies</button>
                <button className="import-btn import-btn-cancel" onClick={onClose}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ─── Community View ─────────────────────────────────────────
    function timeAgo(timestamp) {
      if (!timestamp) return "";
      var date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      var seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) return "just now";
      var minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + "m ago";
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h ago";
      var days = Math.floor(hours / 24);
      if (days < 30) return days + "d ago";
      var months = Math.floor(days / 30);
      return months + "mo ago";
    }

    function ActivityFeed({ onMovieClick }) {
      const [events, setEvents] = useState([]);
      const [expanded, setExpanded] = useState(false);
      const [loading, setLoading] = useState(true);

      useEffect(function() {
        loadActivityFeed(20).then(function(feed) {
          setEvents(feed);
          setLoading(false);
        });
      }, []);

      if (loading || events.length === 0) return null;

      var visible = expanded ? events : events.slice(0, 5);

      function renderEvent(ev) {
        var text = "";
        var label = ev.isTV ? "TV show" : "movie";
        if (ev.type === "ranked" && ev.movie) {
          text = React.createElement("span", null,
            React.createElement("strong", null, ev.displayName),
            " ranked ",
            React.createElement("strong", null, ev.movie.title),
            " at #" + ev.rank + (ev.isTV ? " (TV)" : "")
          );
        } else if (ev.type === "top10") {
          text = React.createElement("span", null,
            React.createElement("strong", null, ev.displayName),
            "\u2019s top 10 " + (ev.isTV ? "TV shows" : "movies") + " changed"
          );
        } else if (ev.type === "milestone") {
          text = React.createElement("span", null,
            "\uD83C\uDF89 ",
            React.createElement("strong", null, ev.displayName),
            " ranked their " + ev.count + (ev.count === 1 ? "st" : ev.count === 2 ? "nd" : ev.count === 3 ? "rd" : "th") + " " + label + "!"
          );
        } else if (ev.type === "joined") {
          text = React.createElement("span", null,
            React.createElement("strong", null, ev.displayName),
            " joined MOVI!"
          );
        }

        var clickable = ev.type === "ranked" && ev.movie && !!onMovieClick;
        return React.createElement("div", {
            key: ev._id,
            className: "activity-item" + (clickable ? " clickable" : ""),
            onClick: clickable ? function() { onMovieClick(ev.movie, !!ev.isTV); } : undefined,
            title: clickable ? "See where you ranked " + ev.movie.title : undefined
          },
          ev.photoURL
            ? React.createElement("img", { src: ev.photoURL, className: "activity-avatar", referrerPolicy: "no-referrer" })
            : React.createElement("div", { className: "activity-avatar-ph" }, (ev.displayName || "?")[0]),
          React.createElement("div", { className: "activity-text" }, text),
          ev.type === "ranked" && ev.movie && ev.movie.poster
            ? React.createElement("img", { src: "https://image.tmdb.org/t/p/w92" + ev.movie.poster, className: "activity-poster" })
            : null,
          React.createElement("div", { className: "activity-time" }, timeAgo(ev.timestamp))
        );
      }

      return React.createElement("div", { className: "activity-feed" },
        React.createElement("div", { className: "activity-feed-title" }, "Recent Activity"),
        visible.map(renderEvent),
        !expanded && events.length > 5
          ? React.createElement("button", { className: "activity-more", onClick: function() { setExpanded(true); } }, "Show more")
          : null,
        expanded && events.length > 5
          ? React.createElement("button", { className: "activity-more", onClick: function() { setExpanded(false); } }, "Show less")
          : null
      );
    }

    function computeTrophies(allProfiles) {
      if (!allProfiles || allProfiles.length < 2) return [];
      var trophies = [];

      // Helper: find profile with max value for a stat
      function maxBy(fn, minThreshold) {
        var best = null; var bestVal = -Infinity;
        allProfiles.forEach(function(p) {
          var val = fn(p);
          if (val > bestVal && (!minThreshold || val >= minThreshold)) { best = p; bestVal = val; }
        });
        return best ? { winner: best, val: bestVal } : null;
      }

      function minBy(fn, minMovies) {
        var best = null; var bestVal = Infinity;
        allProfiles.forEach(function(p) {
          if (minMovies && (p.movies || []).length < minMovies) return;
          var val = fn(p);
          if (val !== null && val < bestVal) { best = p; bestVal = val; }
        });
        return best ? { winner: best, val: bestVal } : null;
      }

      function pctGenre(p, genre) { var movies = p.movies || []; if (movies.length < 10) return 0; return countGenre(p, genre) / movies.length * 100; }
      function countGenre(p, genre) { return (p.movies || []).filter(function(m) { return m.genre === genre; }).length; }
      function pctEra(p, minY, maxY) { var movies = p.movies || []; if (movies.length < 10) return 0; return countEra(p, minY, maxY) / movies.length * 100; }
      function countEra(p, minY, maxY) { return (p.movies || []).filter(function(m) { var y = parseInt(m.year); return y >= minY && y <= maxY; }).length; }

      // Volume
      var r = maxBy(function(p) { return p.movieCount || 0; }, 1);
      if (r) trophies.push({ emoji: "\uD83C\uDFAC", name: "Film Buff", winner: r.winner, detail: r.val + " movies" });

      r = maxBy(function(p) { return p.tvShowCount || 0; }, 1);
      if (r) trophies.push({ emoji: "\uD83D\uDCFA", name: "Binge King", winner: r.winner, detail: r.val + " shows" });

      r = maxBy(function(p) { return (p.movieCount || 0) + (p.tvShowCount || 0); }, 1);
      if (r) trophies.push({ emoji: "\uD83D\uDCDA", name: "Completionist", winner: r.winner, detail: r.val + " total" });

      // Genre (% based)
      var genres = [
        { genre: "Horror", emoji: "\uD83D\uDD2A", name: "Horror Fanatic" },
        { genre: "Comedy", emoji: "\uD83D\uDE02", name: "Comedy King" },
        { genre: "Action", emoji: "\uD83D\uDCA5", name: "Action Hero" },
        { genre: "Sci-Fi", emoji: "\uD83E\uDDEA", name: "Sci-Fi Nerd" },
        { genre: "Romance", emoji: "\uD83D\uDC94", name: "Hopeless Romantic" },
        { genre: "Drama", emoji: "\uD83C\uDFAD", name: "Drama Lover" }
      ];
      genres.forEach(function(g) {
        r = maxBy(function(p) { return pctGenre(p, g.genre); }, 1);
        if (r) trophies.push({ emoji: g.emoji, name: g.name, winner: r.winner, detail: Math.round(r.val) + "% " + g.genre.toLowerCase() });
      });

      // Era (% based)
      r = maxBy(function(p) { return pctEra(p, 0, 1979); }, 1);
      if (r) trophies.push({ emoji: "\uD83D\uDCFC", name: "Old Soul", winner: r.winner, detail: Math.round(r.val) + "% pre-1980" });

      r = maxBy(function(p) { return pctEra(p, 1980, 1999); }, 1);
      if (r) trophies.push({ emoji: "\uD83D\uDD79\uFE0F", name: "80s/90s Kid", winner: r.winner, detail: Math.round(r.val) + "% 80s/90s" });

      r = maxBy(function(p) { return pctEra(p, 2020, 2099); }, 1);
      if (r) trophies.push({ emoji: "\u2728", name: "Modern Critic", winner: r.winner, detail: Math.round(r.val) + "% 2020s" });

      // Taste: Mainstream Maven (highest avg TMDB rating in top 10)
      r = maxBy(function(p) {
        var movies = (p.movies || []).slice(0, 10).filter(function(m) { return m.rating; });
        if (movies.length < 5) return -Infinity;
        return movies.reduce(function(sum, m) { return sum + m.rating; }, 0) / movies.length;
      }, 0);
      if (r && r.val > -Infinity) trophies.push({ emoji: "\uD83C\uDFAF", name: "Mainstream Maven", winner: r.winner, detail: "avg " + r.val.toFixed(1) + " TMDB" });

      // Hidden Gem Hunter (lowest avg TMDB rating in top 10)
      r = minBy(function(p) {
        var movies = (p.movies || []).slice(0, 10).filter(function(m) { return m.rating; });
        if (movies.length < 5) return null;
        return movies.reduce(function(sum, m) { return sum + m.rating; }, 0) / movies.length;
      }, 10);
      if (r) trophies.push({ emoji: "\uD83D\uDD0D", name: "Hidden Gem Hunter", winner: r.winner, detail: "avg " + r.val.toFixed(1) + " TMDB" });

      // Globe Trotter (most unique genres)
      r = maxBy(function(p) {
        var g = {};
        (p.movies || []).forEach(function(m) { if (m.genre) g[m.genre] = true; });
        return Object.keys(g).length;
      }, 3);
      if (r) trophies.push({ emoji: "\uD83C\uDF0D", name: "Globe Trotter", winner: r.winner, detail: r.val + " genres" });

      // Time Traveler (widest year range)
      r = maxBy(function(p) {
        var years = (p.movies || []).map(function(m) { return parseInt(m.year); }).filter(function(y) { return y > 1900; });
        if (years.length < 5) return 0;
        return Math.max.apply(null, years) - Math.min.apply(null, years);
      }, 10);
      if (r) trophies.push({ emoji: "\uD83D\uDCC5", name: "Time Traveler", winner: r.winner, detail: r.val + " year span" });

      // Social trophies — compute pairwise compatibility
      // Build compatibility matrix
      var compatScores = {};
      var bestPairScore = -1;
      var bestPair = null;
      allProfiles.forEach(function(a) {
        compatScores[a.uid] = { total: 0, count: 0 };
      });
      for (var i = 0; i < allProfiles.length; i++) {
        for (var j = i + 1; j < allProfiles.length; j++) {
          var a = allProfiles[i]; var b = allProfiles[j];
          var score = computeCompatibility(a.movies || [], a.tvShows || [], b.movies || [], b.tvShows || []);
          if (score !== null) {
            compatScores[a.uid].total += score; compatScores[a.uid].count++;
            compatScores[b.uid].total += score; compatScores[b.uid].count++;
            if (score > bestPairScore) { bestPairScore = score; bestPair = [a, b]; }
          }
        }
      }

      // Hottest Take — #1 movie ranked lowest by others
      var hottestProfile = null; var hottestAvgRank = -1;
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 5) return;
        var top1Id = p.movies[0].id;
        var ranks = [];
        allProfiles.forEach(function(other) {
          if (other.uid === p.uid || !other.movies) return;
          var idx = -1;
          for (var k = 0; k < other.movies.length; k++) {
            if (other.movies[k].id === top1Id) { idx = k; break; }
          }
          if (idx >= 0 && other.movies.length > 1) {
            ranks.push(idx / (other.movies.length - 1)); // normalized 0-1, higher = lower ranked
          }
        });
        if (ranks.length >= 1) {
          var avg = ranks.reduce(function(s, v) { return s + v; }, 0) / ranks.length;
          if (avg > hottestAvgRank) { hottestAvgRank = avg; hottestProfile = p; }
        }
      });
      if (hottestProfile) {
        trophies.push({ emoji: "\uD83C\uDF36\uFE0F", name: "Hottest Take", winner: hottestProfile, detail: "#1: " + hottestProfile.movies[0].title });
      }

      // Crowd Pleaser (highest avg compat)
      var crowdBest = null; var crowdBestAvg = -1;
      allProfiles.forEach(function(p) {
        var cs = compatScores[p.uid];
        if (cs && cs.count >= 1) {
          var avg = cs.total / cs.count;
          if (avg > crowdBestAvg) { crowdBestAvg = avg; crowdBest = p; }
        }
      });
      if (crowdBest) trophies.push({ emoji: "\uD83D\uDC11", name: "Crowd Pleaser", winner: crowdBest, detail: Math.round(crowdBestAvg) + "% avg" });

      // Lone Wolf (lowest avg compat)
      var loneBest = null; var loneBestAvg = Infinity;
      allProfiles.forEach(function(p) {
        var cs = compatScores[p.uid];
        if (cs && cs.count >= 1) {
          var avg = cs.total / cs.count;
          if (avg < loneBestAvg) { loneBestAvg = avg; loneBest = p; }
        }
      });
      if (loneBest) trophies.push({ emoji: "\uD83D\uDC3A", name: "Lone Wolf", winner: loneBest, detail: Math.round(loneBestAvg) + "% avg" });

      // The Contrarian — biggest single-movie ranking gap vs community average
      var contrarianBest = null; var contrarianGap = -1; var contrarianMovie = null;
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 10) return;
        p.movies.forEach(function(m, myIdx) {
          var myNorm = myIdx / (p.movies.length - 1);
          var otherNorms = [];
          allProfiles.forEach(function(other) {
            if (other.uid === p.uid || !other.movies || other.movies.length < 5) return;
            for (var k = 0; k < other.movies.length; k++) {
              if (other.movies[k].id === m.id) {
                otherNorms.push(k / (other.movies.length - 1));
                break;
              }
            }
          });
          if (otherNorms.length >= 1) {
            var avgOther = otherNorms.reduce(function(s, v) { return s + v; }, 0) / otherNorms.length;
            var gap = Math.abs(myNorm - avgOther);
            if (gap > contrarianGap) { contrarianGap = gap; contrarianBest = p; contrarianMovie = m; }
          }
        });
      });
      if (contrarianBest && contrarianMovie) {
        trophies.push({ emoji: "\uD83D\uDCCF", name: "The Contrarian", winner: contrarianBest, detail: contrarianMovie.title });
      }

      // Taste Twins
      if (bestPair && bestPairScore > 0) {
        trophies.push({
          emoji: "\uD83D\uDC6F", name: "Taste Twins",
          winner: bestPair[0], winner2: bestPair[1],
          detail: bestPairScore + "% match"
        });
      }

      return trophies;
    }

    var TROPHY_DESCRIPTIONS = {
      "Film Buff": "Most movies ranked in the community",
      "Binge King": "Most TV shows ranked in the community",
      "Completionist": "Most total movies and TV shows ranked combined",
      "Horror Fanatic": "Highest percentage of ranked movies are horror",
      "Comedy King": "Highest percentage of ranked movies are comedies",
      "Action Hero": "Highest percentage of ranked movies are action",
      "Sci-Fi Nerd": "Highest percentage of ranked movies are sci-fi",
      "Hopeless Romantic": "Highest percentage of ranked movies are romance",
      "Drama Lover": "Highest percentage of ranked movies are dramas",
      "Old Soul": "Highest percentage of ranked movies are from before 1980",
      "80s/90s Kid": "Highest percentage of ranked movies are from the 1980s and 1990s",
      "Modern Critic": "Highest percentage of ranked movies are from 2020 and beyond",
      "Mainstream Maven": "Highest average TMDB rating across their top 10 movies",
      "Hidden Gem Hunter": "Lowest average TMDB rating across their top 10 \u2014 loves the underdogs",
      "Globe Trotter": "Most diverse taste \u2014 ranks across the most different genres",
      "Time Traveler": "Widest year range between their oldest and newest ranked movie",
      "Hottest Take": "Their #1 movie is ranked the lowest by everyone else",
      "Crowd Pleaser": "Highest average compatibility with all other users",
      "Lone Wolf": "Lowest average compatibility \u2014 the most unique taste",
      "The Contrarian": "Biggest ranking gap vs. the community average on a single movie",
      "Taste Twins": "The two users with the highest compatibility score"
    };

    // ─── Personal Badges: community-wide unique assignment ────────────────────
    function computePersonalBadges(allProfiles) {
      if (!allProfiles || allProfiles.length === 0) return new Map();

      // ── helpers ──────────────────────────────────────────────────────────────
      function pctMovieGenre(movies, genre) {
        if (!movies || movies.length < 5) return 0;
        return movies.filter(function(m) { return m.genre === genre; }).length / movies.length;
      }
      function pctTvGenre(tv, genre) {
        if (!tv || tv.length < 5) return 0;
        return tv.filter(function(m) { return m.genre === genre; }).length / tv.length;
      }
      function pctDecade(movies, min, max) {
        if (!movies || movies.length < 5) return 0;
        return movies.filter(function(m) { var y = parseInt(m.year); return y >= min && y <= max; }).length / movies.length;
      }
      function top10Avg(movies) {
        var rated = (movies || []).slice(0, 10).filter(function(m) { return m.rating; });
        if (rated.length < 5) return null;
        return rated.reduce(function(s, m) { return s + m.rating; }, 0) / rated.length;
      }
      function distinctGenreCount(movies) {
        var g = {};
        (movies || []).forEach(function(m) { if (m.genre) g[m.genre] = true; });
        return Object.keys(g).length;
      }
      function movieYears(movies) {
        return (movies || []).map(function(m) { return parseInt(m.year); }).filter(function(y) { return y > 1900; });
      }
      function avgTitleLen(movies) {
        var items = (movies || []).slice(0, 10);
        if (items.length < 3) return null;
        return items.reduce(function(s, m) { return s + (m.title || "").length; }, 0) / items.length;
      }

      // ── candidate list builder ────────────────────────────────────────────────
      var allCands = []; // {uid, label, emoji, strength, tooltip}
      function push(uid, label, emoji, strength, tooltip) {
        allCands.push({ uid: uid, label: label, emoji: emoji, strength: strength, tooltip: tooltip });
      }

      var MOVIE_GENRES = [
        { g: "Horror",      e: "\uD83D\uDD2A", l: "Horror Soul" },
        { g: "Comedy",      e: "\uD83D\uDE02", l: "Laugh Track" },
        { g: "Action",      e: "\uD83D\uDCA5", l: "Action Junkie" },
        { g: "Sci-Fi",      e: "\uD83E\uDDEA", l: "Sci-Fi Devotee" },
        { g: "Romance",     e: "\uD83D\uDC98", l: "Hopeless Romantic" },
        { g: "Drama",       e: "\uD83C\uDFAD", l: "Drama Seeker" },
        { g: "Animation",   e: "\uD83C\uDFA8", l: "Animation Fan" },
        { g: "Thriller",    e: "\uD83D\uDE31", l: "Thrill Seeker" },
        { g: "Documentary", e: "\uD83C\uDFA5", l: "Doc Enthusiast" },
        { g: "Fantasy",     e: "\uD83E\uDDD9", l: "Fantasy Dreamer" },
        { g: "Mystery",     e: "\uD83D\uDD75\uFE0F", l: "Sleuth" },
        { g: "Crime",       e: "\uD83D\uDD2B", l: "Crime Buff" },
        { g: "Family",      e: "\uD83D\uDC6A", l: "Family Viewer" },
        { g: "Adventure",   e: "\uD83D\uDDFA\uFE0F", l: "Adventurer" },
        { g: "War",         e: "\u2694\uFE0F", l: "War Film Fan" },
        { g: "Western",     e: "\uD83E\uDD20", l: "Wild West Fan" },
        { g: "Music",       e: "\uD83C\uDFB5", l: "Music Lover" },
        { g: "History",     e: "\uD83D\uDCDC", l: "History Buff" }
      ];
      var TV_GENRES = [
        { g: "Comedy",      e: "\uD83D\uDCFA", l: "Sitcom Scholar" },
        { g: "Crime",       e: "\uD83D\uDEA8", l: "Procedural Pro" },
        { g: "Drama",       e: "\uD83C\uDFC6", l: "Prestige Binger" },
        { g: "Animation",   e: "\uD83D\uDD78\uFE0F", l: "Anime Acolyte" },
        { g: "Reality",     e: "\uD83D\uDE48", l: "Reality Rider" },
        { g: "Documentary", e: "\uD83D\uDCC4", l: "Docu-Series Devotee" },
        { g: "Sci-Fi",      e: "\uD83D\uDE80", l: "Sci-Fi Showrunner" },
        { g: "Thriller",    e: "\uD83D\uDE28", l: "Edge-of-Seat Fan" },
        { g: "Fantasy",     e: "\uD83C\uDF09", l: "Fantasy Realm" },
        { g: "Action",      e: "\uD83D\uDCA8", l: "TV Action Fan" },
        { g: "Horror",      e: "\uD83D\uDC7B", l: "Scary TV Fan" },
        { g: "Romance",     e: "\uD83D\uDC9E", l: "TV Romantic" }
      ];
      var DECADE_DEFS = [
        { min: 1900, max: 1969, l: "Classic Cinephile", e: "\uD83C\uDFA9", era: "pre-1970" },
        { min: 1970, max: 1979, l: "70s Rebel",         e: "\u270C\uFE0F",  era: "the 1970s" },
        { min: 1980, max: 1989, l: "80s Kid",           e: "\uD83D\uDCFC", era: "the 1980s" },
        { min: 1990, max: 1999, l: "90s Kid",           e: "\uD83D\uDCC0", era: "the 1990s" },
        { min: 2000, max: 2009, l: "2000s Fan",         e: "\uD83D\uDCBF", era: "the 2000s" },
        { min: 2010, max: 2019, l: "2010s Binger",      e: "\uD83D\uDCF1", era: "the 2010s" },
        { min: 2020, max: 2099, l: "Now Watcher",       e: "\u2728",       era: "2020 onwards" }
      ];

      // ── per-user candidates ─────────────────────────────────────────────────
      allProfiles.forEach(function(p) {
        var mv = p.movies || [];
        var tv = p.tvShows || [];
        var uid = p.uid;
        var total = mv.length + tv.length;

        // A: Genre — movies
        MOVIE_GENRES.forEach(function(g) {
          var pct = pctMovieGenre(mv, g.g);
          if (pct >= 0.30) push(uid, g.l, g.e, pct, Math.round(pct * 100) + "% of their ranked movies are " + g.g);
        });

        // B: Genre — TV
        TV_GENRES.forEach(function(g) {
          var pct = pctTvGenre(tv, g.g);
          if (pct >= 0.30) push(uid, g.l, g.e, pct, Math.round(pct * 100) + "% of their ranked shows are " + g.g);
        });

        // C: Decade — movies
        DECADE_DEFS.forEach(function(d) {
          var pct = pctDecade(mv, d.min, d.max);
          if (pct >= 0.30) push(uid, d.l, d.e, pct, Math.round(pct * 100) + "% of their movies are from " + d.era);
        });

        // D: Rating signals
        var avg = top10Avg(mv);
        if (avg !== null) {
          push(uid, "Tastemaker",        "\uD83C\uDFC5", avg,        "Top 10 avg " + avg.toFixed(1) + " on TMDB \u2014 high-calibre picks");
          push(uid, "Hidden Gem Hunter", "\uD83D\uDD0D", 10 - avg,   "Top 10 avg " + avg.toFixed(1) + " on TMDB \u2014 loves the underrated");
          var top5rated = mv.slice(0, 5).filter(function(m) { return m.rating; });
          if (top5rated.length >= 3) {
            var minR = Math.min.apply(null, top5rated.map(function(m) { return m.rating; }));
            push(uid, "All Killer", "\uD83D\uDCBB", minR, "Even their #5 is rated " + minR.toFixed(1) + " on TMDB");
          }
          if (mv.length >= 8) {
            var top10rated = mv.slice(0, 10).filter(function(m) { return m.rating; });
            if (top10rated.length >= 5) {
              var maxR = Math.max.apply(null, top10rated.map(function(m) { return m.rating; }));
              var minRt = Math.min.apply(null, top10rated.map(function(m) { return m.rating; }));
              push(uid, "Risk Taker", "\uD83C\uDFB2", maxR - minRt, "Top 10 ratings span " + (maxR - minRt).toFixed(1) + " points");
            }
          }
        }

        // E: Year extremes (cross-user part handled below; span + decade count here)
        var yrs = movieYears(mv);
        if (yrs.length >= 5) {
          var span = Math.max.apply(null, yrs) - Math.min.apply(null, yrs);
          if (span >= 30) push(uid, "Time Traveler", "\u23F3", span, "Rankings span " + span + " years");
          var dcs = {};
          yrs.forEach(function(y) { dcs[Math.floor(y / 10) * 10] = true; });
          var dcCount = Object.keys(dcs).length;
          if (dcCount >= 5) push(uid, "Century Scholar", "\uD83D\uDDBC\uFE0F", dcCount, "Movies from " + dcCount + " different decades");
        }

        // F: Variety / Specialist
        if (mv.length >= 8) {
          var dg = distinctGenreCount(mv);
          if (dg >= 6) push(uid, "Genre Omnivore", "\uD83C\uDF0D", dg, "Ranks across " + dg + " different movie genres");
        }
        if (mv.length >= 10) {
          var dg2 = distinctGenreCount(mv);
          if (dg2 <= 2) push(uid, "Specialist", "\uD83D\uDD2C", 10 - dg2, "Sticks to " + dg2 + " genre" + (dg2 === 1 ? "" : "s") + " \u2014 knows exactly what they like");
        }

        // G: Top-5 patterns
        if (mv.length >= 5) {
          var t5 = mv.slice(0, 5);
          var t5g = t5.map(function(m) { return m.genre; }).filter(Boolean);
          var t5d = t5.map(function(m) { return Math.floor(parseInt(m.year) / 10) * 10; }).filter(function(d) { return d > 190; });
          var t5l = t5.map(function(m) { return ((m.title || "")[0] || "").toUpperCase(); }).filter(Boolean);
          var uniqueG = Array.from ? Array.from(new Set(t5g)) : t5g.filter(function(v, i, a) { return a.indexOf(v) === i; });
          var uniqueD = Array.from ? Array.from(new Set(t5d)) : t5d.filter(function(v, i, a) { return a.indexOf(v) === i; });
          var uniqueL = Array.from ? Array.from(new Set(t5l)) : t5l.filter(function(v, i, a) { return a.indexOf(v) === i; });
          if (t5g.length >= 4 && uniqueG.length === 1)  push(uid, "True to Genre",   "\uD83D\uDCA1", 1, "Top 5 movies are all " + t5g[0]);
          if (t5d.length >= 4 && uniqueD.length === 1)  push(uid, "Decade Loyalist",  "\uD83D\uDCC6", 1, "Top 5 movies all from the " + t5d[0] + "s");
          if (t5g.length >= 5 && uniqueG.length >= 5)   push(uid, "Wild Card",        "\uD83C\uDCCF", 1, "Top 5 movies span 5 completely different genres");
          if (t5l.length >= 5 && uniqueL.length === 1)  push(uid, "Letter Locked",    "\uD83D\uDCDD", 1, "Top 5 all start with \"" + t5l[0] + "\"");
          if (t5l.length >= 5 && uniqueL.length >= 5)   push(uid, "Alphabet Soup",    "\uD83D\uDD24", 1, "Top 5 start with 5 different letters");
        }
        if (mv.length >= 5) {
          var atl = avgTitleLen(mv);
          if (atl !== null) {
            push(uid, "Long Titles",  "\uD83D\uDCD6", atl,     "Average title in their top 10 is " + Math.round(atl) + " characters");
            push(uid, "Short & Sweet","\u26A1",       -atl,    "Average title in their top 10 is " + Math.round(atl) + " characters");
          }
        }

        // H: Volume bands (add all qualifying — greedy picks highest available)
        if (total >= 100) push(uid, "Century Club",  "\uD83D\uDCDA", total, total + " titles ranked \u2014 absolute legend");
        if (total >= 50)  push(uid, "Half Century",  "\uD83D\uDCCA", total, total + " titles ranked");
        if (total >= 25)  push(uid, "Quarter Club",  "\uD83C\uDF96\uFE0F", total, total + " titles ranked");
        if (total >= 10)  push(uid, "Starter Pack",  "\uD83D\uDD16", total, total + " titles ranked");
        if (total >= 5)   push(uid, "Rising Ranker", "\uD83D\uDCDD", total, total + " titles ranked");
        if (total === 0)  push(uid, "Fresh Face",    "\uD83C\uDF31", 0,    "Just joined \u2014 rankings coming soon!");

        // I: Medium ratio
        if (mv.length >= 10 && tv.length === 0) push(uid, "Pure Cinephile", "\uD83C\uDFAC", mv.length, mv.length + " movies, no TV \u2014 cinema purist");
        if (tv.length >= 10 && mv.length === 0) push(uid, "TV Evangelist",  "\uD83D\uDCFA", tv.length, tv.length + " shows, no movies");
        if (mv.length >= 5 && tv.length >= 5)   push(uid, "Dual Threat",    "\u2694\uFE0F", Math.min(mv.length, tv.length), mv.length + " movies + " + tv.length + " shows");
        if (total >= 15 && tv.length > 0 && mv.length / tv.length >= 3) push(uid, "Film First", "\uD83D\uDD35", mv.length / tv.length, "Movies \u2013 shows ratio: " + mv.length + ":" + tv.length);
        if (total >= 15 && mv.length > 0 && tv.length / mv.length >= 3) push(uid, "TV First",   "\uD83D\uDFE3", tv.length / mv.length, "Shows \u2013 movies ratio: " + tv.length + ":" + mv.length);

        // J: Watchlist
        var wc = p.watchlistCount || 0;
        var twc = p.tvWatchlistCount || 0;
        if (wc > 0)  push(uid, "Watchlist Hoarder", "\uD83D\uDCCB", wc,  wc + " movies saved to the watchlist");
        if (twc > 0) push(uid, "Queue Master",      "\uD83D\uDCBC", twc, twc + " shows in the TV queue");
        if (total >= 5) {
          var compR = total / (total + wc + twc + 1);
          push(uid, "Completionist", "\uD83C\uDFC1", compR, "More time ranking than collecting \u2014 gets it done");
        }
      });

      // ── cross-user: year extremes ─────────────────────────────────────────────
      var globalMinYr = Infinity; var globalMaxYr = -Infinity;
      allProfiles.forEach(function(p) {
        var yrs = movieYears(p.movies || []);
        if (!yrs.length) return;
        var mn = Math.min.apply(null, yrs); var mx = Math.max.apply(null, yrs);
        if (mn < globalMinYr) globalMinYr = mn;
        if (mx > globalMaxYr) globalMaxYr = mx;
      });
      allProfiles.forEach(function(p) {
        var yrs = movieYears(p.movies || []);
        if (yrs.length < 3) return;
        var mn = Math.min.apply(null, yrs); var mx = Math.max.apply(null, yrs);
        if (mn === globalMinYr && globalMinYr < Infinity)
          push(p.uid, "The Archaeologist", "\uD83D\uDFBA", 10000 - mn, "Has the oldest ranked film in the community (" + mn + ")");
        if (mx === globalMaxYr && globalMaxYr > -Infinity)
          push(p.uid, "The Futurist", "\uD83D\uDEF8", mx, "Has the newest ranked film in the community (" + mx + ")");
      });

      // ── cross-user: social / comparative ─────────────────────────────────────
      var compat = {};
      allProfiles.forEach(function(p) { compat[p.uid] = { total: 0, count: 0 }; });
      for (var i = 0; i < allProfiles.length; i++) {
        for (var j = i + 1; j < allProfiles.length; j++) {
          var a = allProfiles[i]; var b = allProfiles[j];
          var sc = computeCompatibility(a.movies || [], a.tvShows || [], b.movies || [], b.tvShows || []);
          if (sc !== null) {
            compat[a.uid].total += sc; compat[a.uid].count++;
            compat[b.uid].total += sc; compat[b.uid].count++;
          }
        }
      }
      allProfiles.forEach(function(p) {
        var cs = compat[p.uid];
        if (!cs || cs.count < 1) return;
        var avg = cs.total / cs.count;
        push(p.uid, "Crowd Pleaser", "\uD83D\uDC11", avg,       Math.round(avg) + "% avg compatibility \u2014 taste everyone shares");
        push(p.uid, "Lone Wolf",     "\uD83D\uDC3A", 100 - avg, Math.round(avg) + "% avg compatibility \u2014 totally unique taste");
      });

      // Hottest Take: #1 movie ranked lowest by others
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 5) return;
        var id1 = p.movies[0].id; var ranks = [];
        allProfiles.forEach(function(o) {
          if (o.uid === p.uid || !o.movies) return;
          for (var k = 0; k < o.movies.length; k++) {
            if (o.movies[k].id === id1) { ranks.push(k / Math.max(o.movies.length - 1, 1)); break; }
          }
        });
        if (ranks.length >= 1) {
          var avgR = ranks.reduce(function(s, v) { return s + v; }, 0) / ranks.length;
          push(p.uid, "Hottest Take", "\uD83C\uDF36\uFE0F", avgR, "#1 pick (\"" + p.movies[0].title + "\") is ranked much lower by others");
        }
      });

      // The Contrarian: biggest rank gap vs community on any movie
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 10) return;
        var bestGap = 0; var bestMov = null;
        p.movies.forEach(function(m, mi) {
          var myNorm = mi / Math.max(p.movies.length - 1, 1); var others = [];
          allProfiles.forEach(function(o) {
            if (o.uid === p.uid || !o.movies || o.movies.length < 5) return;
            for (var k = 0; k < o.movies.length; k++) {
              if (o.movies[k].id === m.id) { others.push(k / Math.max(o.movies.length - 1, 1)); break; }
            }
          });
          if (others.length >= 1) {
            var gap = Math.abs(myNorm - others.reduce(function(s, v) { return s + v; }, 0) / others.length);
            if (gap > bestGap) { bestGap = gap; bestMov = m; }
          }
        });
        if (bestMov) push(p.uid, "The Contrarian", "\uD83D\uDCCF", bestGap, "Ranks \"" + bestMov.title + "\" very differently from everyone else");
      });

      // #1 Defender: #1 movie appears in no other user's top 5
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 3) return;
        var id1 = p.movies[0].id;
        var shared = allProfiles.some(function(o) {
          return o.uid !== p.uid && (o.movies || []).slice(0, 5).some(function(m) { return m.id === id1; });
        });
        if (!shared) push(p.uid, "#1 Defender", "\uD83D\uDEE1\uFE0F", 1, "\"" + p.movies[0].title + "\" is theirs alone at #1");
      });

      // Consensus Pick: #1 movie most widely shared in others' top 10
      allProfiles.forEach(function(p) {
        if (!p.movies || p.movies.length < 3) return;
        var id1 = p.movies[0].id;
        var cnt = allProfiles.filter(function(o) {
          return o.uid !== p.uid && (o.movies || []).slice(0, 10).some(function(m) { return m.id === id1; });
        }).length;
        if (cnt >= 1) push(p.uid, "Consensus Pick", "\uD83E\uDD1D", cnt, "\"" + p.movies[0].title + "\" is loved by " + cnt + " other" + (cnt === 1 ? "" : "s") + " in the community");
      });

      // ── greedy unique assignment ──────────────────────────────────────────────
      var LABEL_ORDER = [
        // Genre — movies (most distinctive personality)
        "Horror Soul","Laugh Track","Action Junkie","Sci-Fi Devotee","Hopeless Romantic","Drama Seeker",
        "Animation Fan","Thrill Seeker","Doc Enthusiast","Fantasy Dreamer","Sleuth","Crime Buff",
        "Family Viewer","Adventurer","War Film Fan","Wild West Fan","Music Lover","History Buff",
        // Genre — TV
        "Sitcom Scholar","Procedural Pro","Prestige Binger","Anime Acolyte","Reality Rider",
        "Docu-Series Devotee","Sci-Fi Showrunner","Edge-of-Seat Fan","Fantasy Realm",
        "TV Action Fan","Scary TV Fan","TV Romantic",
        // Social / comparative
        "Hottest Take","#1 Defender","The Contrarian","Consensus Pick","Crowd Pleaser","Lone Wolf",
        // Year extremes
        "The Archaeologist","The Futurist","Time Traveler","Century Scholar",
        // Top-5 patterns
        "True to Genre","Decade Loyalist","Wild Card","Letter Locked","Alphabet Soup",
        "Long Titles","Short & Sweet",
        // Rating signals
        "Tastemaker","Hidden Gem Hunter","All Killer","Risk Taker",
        // Variety / specialist
        "Genre Omnivore","Specialist",
        // Decade — movies
        "Classic Cinephile","70s Rebel","80s Kid","90s Kid","2000s Fan","2010s Binger","Now Watcher",
        // Medium ratio
        "Pure Cinephile","TV Evangelist","Dual Threat","Film First","TV First",
        // Watchlist
        "Watchlist Hoarder","Queue Master","Completionist",
        // Volume (from most to least)
        "Century Club","Half Century","Quarter Club","Starter Pack","Rising Ranker",
        // Catch-all
        "Fresh Face"
      ];

      // group and sort by strength
      var byLabel = {};
      allCands.forEach(function(c) {
        if (!byLabel[c.label]) byLabel[c.label] = [];
        byLabel[c.label].push(c);
      });
      Object.keys(byLabel).forEach(function(l) {
        byLabel[l].sort(function(a, b) { return b.strength - a.strength; });
      });

      var assigned = {};
      LABEL_ORDER.forEach(function(label) {
        (byLabel[label] || []).some(function(c) {
          if (!assigned[c.uid]) { assigned[c.uid] = { emoji: c.emoji, label: c.label, tooltip: c.tooltip }; return true; }
        });
      });

      // ── fallback: naturally unique badges ─────────────────────────────────────
      var usedTitles = {};
      allProfiles.forEach(function(p) {
        if (assigned[p.uid]) return;
        var picks = (p.movies || []).concat(p.tvShows || []);
        for (var fi = 0; fi < Math.min(picks.length, 5); fi++) {
          var pick = picks[fi];
          if (pick && !usedTitles[pick.id]) {
            usedTitles[pick.id] = true;
            var short = (pick.title || "").length > 22 ? pick.title.slice(0, 22) + "\u2026" : pick.title;
            var rankLabel = fi === 0 ? "#1" : fi === 1 ? "#2" : "#" + (fi + 1);
            var rankEmoji = fi === 0 ? "\uD83E\uDD47" : fi === 1 ? "\uD83E\uDD48" : "\uD83E\uDD49";
            assigned[p.uid] = { emoji: rankEmoji, label: rankLabel + ": " + short, tooltip: "Top pick: " + pick.title };
            return;
          }
        }
        // Last resort: genre or decade of top pick
        var top = picks[0];
        if (top && top.genre) {
          assigned[p.uid] = { emoji: "\uD83C\uDF9E\uFE0F", label: top.genre + " Fan", tooltip: "Their top pick is " + top.genre };
        } else if (top && top.year) {
          var dec = Math.floor(parseInt(top.year) / 10) * 10;
          assigned[p.uid] = { emoji: "\uD83D\uDCC5", label: "Rooted in " + (dec % 100) + "s", tooltip: "Top pick from " + top.year };
        } else {
          assigned[p.uid] = { emoji: "\uD83C\uDFAB", label: "Getting Started", tooltip: "Building their list" };
        }
      });

      var result = new Map();
      allProfiles.forEach(function(p) {
        result.set(p.uid, assigned[p.uid] || { emoji: "\uD83C\uDF31", label: "Fresh Face", tooltip: "Just joined!" });
      });
      return result;
    }

    function TrophyShelf({ trophies, onViewProfile }) {
      const [selected, setSelected] = useState(null);
      if (!trophies || trophies.length === 0) return null;

      function renderAvatar(p) {
        if (!p) return null;
        return p.photoURL
          ? React.createElement("img", { src: p.photoURL, className: "trophy-avatar", referrerPolicy: "no-referrer" })
          : React.createElement("div", { className: "trophy-avatar-ph" }, (p.displayName || "?")[0]);
      }

      return React.createElement("div", null,
        React.createElement("div", { className: "trophy-section-title" }, "\uD83C\uDFC6 Community Awards"),
        selected !== null && trophies[selected] ? React.createElement("div", { className: "trophy-explainer" },
          React.createElement("button", { className: "trophy-explainer-close", onClick: function() { setSelected(null); } }, "\u00d7"),
          React.createElement("strong", null, trophies[selected].emoji + " " + trophies[selected].name),
          " \u2014 ",
          TROPHY_DESCRIPTIONS[trophies[selected].name] || ""
        ) : null,
        React.createElement("div", { className: "trophy-shelf" },
          trophies.map(function(t, idx) {
            return React.createElement("div", {
              key: idx,
              className: "trophy-card" + (selected === idx ? " trophy-card-selected" : ""),
              onClick: function(e) {
                e.stopPropagation();
                if (selected === idx) {
                  onViewProfile(t.winner.uid);
                } else {
                  setSelected(idx);
                }
              }
            },
              React.createElement("div", { className: "trophy-emoji" }, t.emoji),
              React.createElement("div", { className: "trophy-name" }, t.name),
              React.createElement("div", { className: "trophy-winner-row" },
                renderAvatar(t.winner),
                t.winner2 ? renderAvatar(t.winner2) : null,
                React.createElement("div", { className: "trophy-winner-name" },
                  t.winner2
                    ? (t.winner.displayName || "?").split(" ")[0] + " & " + (t.winner2.displayName || "?").split(" ")[0]
                    : t.winner.displayName || "Anonymous"
                )
              ),
              React.createElement("div", { className: "trophy-detail" }, t.detail)
            );
          })
        )
      );
    }

    function CommunityView({ onViewProfile, currentUid, currentDisplayName, currentPhotoURL, isAdmin, myMovies, myTv, onMovieClick }) {
      const [profiles, setProfiles] = useState([]);
      const [me, setMe] = useState(null);
      const [trophies, setTrophies] = useState([]);
      const [badges, setBadges] = useState(new Map());
      const [loading, setLoading] = useState(true);
      const [showExplainer, setShowExplainer] = useState(false);
      const [badgeModal, setBadgeModal] = useState(null);

      useEffect(() => {
        loadCommunityProfiles().then(p => {
          // Compute trophies using all non-private profiles (including current user).
          // Private users opted out of sharing rankings, so their data shouldn't
          // surface through awards like "Hottest Take: #1 <title>".
          setTrophies(computeTrophies(p.filter(pr => !pr.isPrivate)));

          // Split out current user
          let mine = currentUid ? p.find(pr => pr.uid === currentUid) : null;
          if (!mine && currentUid && ((myMovies && myMovies.length > 0) || (myTv && myTv.length > 0))) {
            mine = {
              uid: currentUid,
              displayName: currentDisplayName || "You",
              photoURL: currentPhotoURL || null,
              movies: myMovies || [],
              tvShows: myTv || [],
              movieCount: (myMovies || []).length,
              tvShowCount: (myTv || []).length
            };
          }
          setMe(mine || null);

          // Compute unique personal badges across everyone (including synthesized me if not in list)
          const allForBadges = mine && !p.find(pr => pr.uid === currentUid) ? [...p, mine] : p;
          setBadges(computePersonalBadges(allForBadges));

          let filtered = p.filter(pr => pr.uid !== currentUid);
          // Compute compatibility scores and sort
          const hasMyRankings = (myMovies && myMovies.length > 0) || (myTv && myTv.length > 0);
          if (hasMyRankings) {
            filtered = filtered.map(pr => ({
              ...pr,
              compatibility: computeCompatibility(myMovies || [], myTv || [], pr.movies || [], pr.tvShows || [])
            }));
            filtered.sort((a, b) => {
              if (a.compatibility !== null && b.compatibility !== null) return b.compatibility - a.compatibility;
              if (a.compatibility !== null) return -1;
              if (b.compatibility !== null) return 1;
              return 0;
            });
          }
          setProfiles(filtered);
          setLoading(false);
        });
      }, [currentUid, currentDisplayName, currentPhotoURL, myMovies, myTv]);

      function renderCard(p, opts) {
        opts = opts || {};
        const isYou = !!opts.isYou;
        const badge = badges.get(p.uid);
        return (
          <div key={p.uid} className={"community-card" + (isYou ? " community-card-you" : "")} onClick={() => onViewProfile(p.uid)}>
            {p.photoURL
              ? <img src={p.photoURL} alt="" className="community-card-avatar" referrerPolicy="no-referrer" />
              : <div className="community-card-avatar-ph">{(p.displayName || "?")[0]}</div>
            }
            <div className="community-card-info">
              <div className="community-card-name-row">
                <span className="community-card-name">{p.displayName || "Anonymous"}{isAdmin && p.isPrivate ? " \uD83D\uDD12" : ""}</span>
                {isYou && <span className="community-you-tag">You</span>}
              </div>
              <div className="community-card-meta">
                {(p.movieCount || 0) > 0 && `${p.movieCount} movies`}
                {(p.movieCount || 0) > 0 && (p.tvShowCount || 0) > 0 && " \u00B7 "}
                {(p.tvShowCount || 0) > 0 && `${p.tvShowCount} shows`}
                {(p.movieCount || 0) === 0 && (p.tvShowCount || 0) === 0 && "No rankings yet"}
                {" ranked"}
              </div>
              {badge && (
                <div className="personal-badge" title={badge.tooltip}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBadgeModal({ ...badge, ownerName: p.displayName || "Anonymous", isYou: isYou });
                  }}>
                  <span className="personal-badge-emoji">{badge.emoji}</span>
                  <span className="personal-badge-label">{badge.label}</span>
                </div>
              )}
              {p.movies && p.movies.length > 0 && (!p.isPrivate || isAdmin || isYou) && (
                <div className="community-card-top">
                  {p.movies.slice(0, 5).map(m => (
                    <Poster key={m.id} poster={m.poster} title={m.title}
                      style={{ width: 28, height: 42, borderRadius: 4 }} />
                  ))}
                </div>
              )}
            </div>
            {!isYou && p.compatibility !== undefined && p.compatibility !== null && (
              <div className={`compatibility-badge ${p.compatibility >= 70 ? "compatibility-high" : p.compatibility >= 40 ? "compatibility-mid" : "compatibility-low"}`}
                onClick={(e) => { e.stopPropagation(); setShowExplainer(prev => !prev); }}>
                {p.compatibility}%
              </div>
            )}
            {!isYou && p.compatibility === null && (myMovies && myMovies.length > 0 || myTv && myTv.length > 0) && (
              <div className="compatibility-badge compatibility-low"
                onClick={(e) => { e.stopPropagation(); setShowExplainer(prev => !prev); }}>—</div>
            )}
            <div className="community-card-arrow">&#x203A;</div>
            {!isYou && isAdmin && (
              <button className="community-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete ${p.displayName || "this user"}'s profile?`)) {
                    deleteProfile(p.uid).then(() => {
                      setProfiles(prev => prev.filter(pr => pr.uid !== p.uid));
                    });
                  }
                }}
                title="Delete profile">&#x1F5D1;</button>
            )}
          </div>
        );
      }

      if (!FIREBASE_READY) {
        return (
          <div className="community-section">
            <div className="community-empty">
              <p style={{ fontSize: "2rem", marginBottom: 10 }}>&#x1F465;</p>
              <p>Set up Firebase to see other users' rankings.</p>
              <p style={{ fontSize: "0.8rem", marginTop: 8 }}>See firebase-config.js for instructions.</p>
            </div>
          </div>
        );
      }

      if (loading) {
        return (
          <div className="community-section" style={{ textAlign: "center", padding: 40 }}>
            <div className="spinner"></div>
            <p style={{ color: "var(--text-muted)", marginTop: 12, fontSize: "0.85rem" }}>Loading community...</p>
          </div>
        );
      }

      if (profiles.length === 0 && !me) {
        return (
          <div className="community-section">
            <div className="community-empty">
              <p style={{ fontSize: "2rem", marginBottom: 10 }}>&#x1F465;</p>
              <p>No other users yet. Share your link with friends!</p>
            </div>
          </div>
        );
      }

      return (
        <div className="community-section">
          {showExplainer && (
            <div className="compat-explainer">
              <button className="compat-explainer-close" onClick={() => setShowExplainer(false)}>&times;</button>
              Compatibility % is based on how many movies you have in common and how similarly you ranked them. Higher % = more similar taste!
            </div>
          )}
          <TrophyShelf trophies={trophies} onViewProfile={onViewProfile} />
          <ActivityFeed onMovieClick={onMovieClick} />
          {me && (
            <div className="community-you-block">
              <div className="community-section-label">Your Profile</div>
              {renderCard(me, { isYou: true })}
            </div>
          )}
          {profiles.length > 0 && (
            <>
              {me && <div className="community-section-label">Community</div>}
              <div className="community-list">
                {profiles.map(p => renderCard(p))}
              </div>
            </>
          )}
          {badgeModal && (
            <div className="badge-modal-backdrop" onClick={() => setBadgeModal(null)}>
              <div className="badge-modal" onClick={(e) => e.stopPropagation()}>
                <button className="badge-modal-close" onClick={() => setBadgeModal(null)}>&times;</button>
                <div className="badge-modal-emoji">{badgeModal.emoji}</div>
                <div className="badge-modal-label">{badgeModal.label}</div>
                <div className="badge-modal-who">{badgeModal.isYou ? "Your trophy" : badgeModal.ownerName + "'s trophy"}</div>
                <div className="badge-modal-tooltip">{badgeModal.tooltip}</div>
                <button className="badge-modal-action" onClick={() => setBadgeModal(null)}>Got it</button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── Profile View (viewing someone else's rankings) ─────────
    function ProfileView({ uid, onBack, onAddMovie, onBookmark, rankedIds, tvRankedIds, watchlistIds, tvWatchlistIds, defaultTab, isAdmin, onTabChange, onMovieClick }) {
      const [profile, setProfile] = useState(null);
      const [loading, setLoading] = useState(true);
      const [profileTab, setProfileTab] = useState(defaultTab || "movies");
      const [editedMovies, setEditedMovies] = useState(null);
      const [editedTv, setEditedTv] = useState(null);
      const [saving, setSaving] = useState(false);

      useEffect(() => {
        loadProfile(uid).then(p => {
          setProfile(p);
          if (p) {
            setEditedMovies(p.movies || []);
            setEditedTv(p.tvShows || []);
          }
          setLoading(false);
        });
      }, [uid]);

      if (loading) {
        return (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div className="spinner"></div>
            <p style={{ color: "var(--text-muted)", marginTop: 12 }}>Loading rankings...</p>
          </div>
        );
      }

      if (!profile) {
        return (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ color: "var(--text-muted)" }}>Profile not found.</p>
            <button className="profile-back" onClick={onBack}>Go Back</button>
          </div>
        );
      }

      const movieList = isAdmin && editedMovies ? editedMovies : (profile.movies || []);
      const tvList = isAdmin && editedTv ? editedTv : (profile.tvShows || []);
      const activeList = profileTab === "movies" ? movieList : tvList;
      const activeIds = profileTab === "movies" ? rankedIds : tvRankedIds;
      const activeWlIds = profileTab === "movies" ? watchlistIds : tvWatchlistIds;

      function handleAdminRemove(id) {
        if (profileTab === "movies") {
          setEditedMovies(prev => prev.filter(m => m.id !== id));
        } else {
          setEditedTv(prev => prev.filter(m => m.id !== id));
        }
      }

      function handleAdminMove(draggedId, beforeId) {
        const setter = profileTab === "movies" ? setEditedMovies : setEditedTv;
        setter(prev => {
          const next = prev.slice();
          const fromIdx = next.findIndex(m => m.id === draggedId);
          if (fromIdx === -1) return prev;
          const [item] = next.splice(fromIdx, 1);
          if (beforeId === null) {
            next.push(item);
            return next;
          }
          const toIdx = next.findIndex(m => m.id === beforeId);
          if (toIdx === -1) {
            next.push(item);
            return next;
          }
          next.splice(toIdx, 0, item);
          return next;
        });
      }

      async function handleAdminSave() {
        setSaving(true);
        await adminSaveProfile(uid, editedMovies || [], editedTv || []);
        setSaving(false);
        // Reload profile
        const p = await loadProfile(uid);
        if (p) {
          setProfile(p);
          setEditedMovies(p.movies || []);
          setEditedTv(p.tvShows || []);
        }
      }

      const hasChanges = isAdmin && (
        JSON.stringify(editedMovies) !== JSON.stringify(profile.movies || []) ||
        JSON.stringify(editedTv) !== JSON.stringify(profile.tvShows || [])
      );

      return (
        <div>
          <div className="profile-banner">
            {profile.photoURL
              ? <img src={profile.photoURL} alt="" className="profile-avatar" referrerPolicy="no-referrer" />
              : <div className="profile-avatar-ph">{(profile.displayName || "?")[0]}</div>
            }
            <div className="profile-name">{profile.displayName || "Anonymous"}</div>
            {isAdmin && <div style={{color:"var(--gold)",fontSize:"0.75rem",fontWeight:600,marginBottom:4}}>ADMIN MODE{profile.isPrivate ? " \uD83D\uDD12 Private" : ""}</div>}
            <div className="profile-count">
              {movieList.length > 0 && `${movieList.length} movies`}
              {movieList.length > 0 && tvList.length > 0 && " · "}
              {tvList.length > 0 && `${tvList.length} shows`}
              {" ranked"}
            </div>
            <div className="profile-subtabs">
              <button className={`profile-subtab ${profileTab === "movies" ? "active" : ""}`}
                onClick={() => { setProfileTab("movies"); onTabChange && onTabChange("movies"); }}>Movies ({movieList.length})</button>
              <button className={`profile-subtab ${profileTab === "tv" ? "active" : ""}`}
                onClick={() => { setProfileTab("tv"); onTabChange && onTabChange("tv"); }}>TV Shows ({tvList.length})</button>
            </div>
            {hasChanges && (
              <button className="profile-back" onClick={handleAdminSave}
                style={{background:"#2e7d32",marginRight:8}} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
            <button className="profile-back" onClick={onBack}>&#x2190; Back</button>
          </div>
          {isAdmin ? (
            <RankedList list={activeList} readOnly={false}
              onRemove={handleAdminRemove} onMove={handleAdminMove}
              onClear={() => profileTab === "movies" ? setEditedMovies([]) : setEditedTv([])}
              onAddMovie={(movie) => onAddMovie(movie, profileTab === "tv" ? "tv" : "movies")}
              onBookmark={(movie) => onBookmark(movie, profileTab === "tv" ? "tv" : "movies")}
              rankedIds={activeIds} watchlistIds={activeWlIds}
              onMovieClick={onMovieClick}
              itemLabel={profileTab === "tv" ? "TV show" : "movie"} />
          ) : profile.isPrivate ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text-muted)"}}>
              <div style={{fontSize:"2.5rem",marginBottom:12}}>{"\uD83D\uDD12"}</div>
              <div style={{fontSize:"1rem",fontWeight:600,marginBottom:6}}>Rankings are private</div>
              <div style={{fontSize:"0.8rem"}}>This user has chosen to keep their rankings hidden.</div>
            </div>
          ) : (
            <RankedList list={activeList} readOnly={true}
              onAddMovie={(movie) => onAddMovie(movie, profileTab === "tv" ? "tv" : "movies")}
              onBookmark={(movie) => onBookmark(movie, profileTab === "tv" ? "tv" : "movies")}
              rankedIds={activeIds} watchlistIds={activeWlIds}
              onMovieClick={onMovieClick}
              itemLabel={profileTab === "tv" ? "TV show" : "movie"} />
          )}
        </div>
      );
    }

    // ─── Auth Bar ───────────────────────────────────────────────
    function AuthBar({ user, onSignIn, onSignOut, authLoading, authMode, setAuthMode,
      authEmail, setAuthEmail, authPassword, setAuthPassword, authDisplayName, setAuthDisplayName,
      authError, onEmailSignIn, onEmailSignUp }) {
      if (!FIREBASE_READY) return null;

      if (authLoading) {
        return (
          <div className="auth-bar">
            <div className="spinner"></div>
          </div>
        );
      }

      if (!user && authMode === "signin") {
        return (
          <div className="auth-form">
            <button className="auth-back" onClick={() => setAuthMode(null)}>&larr; Back</button>
            <h3>Sign In</h3>
            {authError && <div className="auth-error">{authError}</div>}
            <input className="auth-input" type="email" placeholder="Email" value={authEmail}
              onChange={e => setAuthEmail(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password" value={authPassword}
              onChange={e => setAuthPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && onEmailSignIn()} />
            <button className="auth-form-submit" onClick={onEmailSignIn}>Sign In</button>
            <div className="auth-form-footer">
              Don't have an account?{" "}
              <button className="auth-link" onClick={() => setAuthMode("signup")}>Sign up</button>
            </div>
          </div>
        );
      }

      if (!user && authMode === "signup") {
        return (
          <div className="auth-form">
            <button className="auth-back" onClick={() => setAuthMode(null)}>&larr; Back</button>
            <h3>Create Account</h3>
            {authError && <div className="auth-error">{authError}</div>}
            <input className="auth-input" type="text" placeholder="Display Name" value={authDisplayName}
              onChange={e => setAuthDisplayName(e.target.value)} />
            <input className="auth-input" type="email" placeholder="Email" value={authEmail}
              onChange={e => setAuthEmail(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password (min. 6 characters)" value={authPassword}
              onChange={e => setAuthPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && onEmailSignUp()} />
            <button className="auth-form-submit" onClick={onEmailSignUp}>Create Account</button>
            <div className="auth-form-footer">
              Already have an account?{" "}
              <button className="auth-link" onClick={() => setAuthMode("signin")}>Sign in</button>
            </div>
          </div>
        );
      }

      if (!user) {
        return (
          <div className="auth-bar" style={{flexDirection: "column", alignItems: "stretch", gap: "8px"}}>
            <button className="auth-btn auth-btn-signin" onClick={onSignIn}>
              Sign in with Google
            </button>
            <div className="auth-divider">or</div>
            <button className="auth-btn auth-btn-email" onClick={() => setAuthMode("signin")}>
              Sign in with Email
            </button>
          </div>
        );
      }

      return (
        <div className="auth-bar">
          <div className="auth-sync">
            <span className="auth-sync-dot"></span> Synced
          </div>
          <div className="auth-user">
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="auth-avatar" referrerPolicy="no-referrer" />
              : <div className="auth-avatar-placeholder">{(user.displayName || "?")[0]}</div>
            }
            <span className="auth-name">{user.displayName}</span>
          </div>
          <button className="auth-btn auth-btn-signout" onClick={onSignOut}>Sign Out</button>
        </div>
      );
    }

    // ─── Stats & Insights ──────────────────────────────────────
    function StatsView({ rankedList, watchlist, isTV }) {
      const itemLabel = isTV ? "shows" : "movies";
      const total = rankedList.length;
      const wlCount = (watchlist || []).length;

      if (total === 0) {
        return <div className="stats-empty">Rank some {itemLabel} to see your stats!</div>;
      }

      // Genre breakdown
      const genreCounts = {};
      rankedList.forEach(m => {
        const genres = (m.genre || "Unknown").split(",").map(g => g.trim());
        genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
      });
      const genreSorted = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
      const maxGenre = genreSorted[0] ? genreSorted[0][1] : 1;
      const topGenre = genreSorted[0] ? genreSorted[0][0] : "N/A";

      // Decade breakdown
      const decadeCounts = {};
      rankedList.forEach(m => {
        const yr = parseInt(m.year);
        if (!isNaN(yr)) {
          const decade = Math.floor(yr / 10) * 10 + "s";
          decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
        }
      });
      const decadeSorted = Object.entries(decadeCounts).sort((a, b) => {
        return parseInt(b[0]) - parseInt(a[0]);
      });
      const maxDecade = decadeSorted.length ? Math.max(...decadeSorted.map(d => d[1])) : 1;

      // Fun insights
      const insights = [];
      if (genreSorted.length > 0) {
        insights.push({ icon: "🎬", text: `Your #1 genre is ${topGenre} with ${genreSorted[0][1]} ${itemLabel}` });
      }
      if (decadeSorted.length > 0) {
        const topDecade = decadeSorted.reduce((a, b) => a[1] >= b[1] ? a : b);
        insights.push({ icon: "📅", text: `Most of your ${itemLabel} are from the ${topDecade[0]}` });
      }
      // Top 3 diversity
      if (rankedList.length >= 3) {
        const top3decades = new Set(rankedList.slice(0, 3).map(m => {
          const yr = parseInt(m.year);
          return isNaN(yr) ? null : Math.floor(yr / 10) * 10 + "s";
        }).filter(Boolean));
        if (top3decades.size === 3) {
          insights.push({ icon: "🌟", text: "Your top 3 are all from different decades!" });
        }
      }
      // 21st century percentage
      const c21 = rankedList.filter(m => parseInt(m.year) >= 2000).length;
      const pct = Math.round((c21 / total) * 100);
      insights.push({ icon: "🔮", text: `${pct}% of your list is from the 21st century` });
      // Unique genres
      if (genreSorted.length >= 5) {
        insights.push({ icon: "🎭", text: `You've explored ${genreSorted.length} different genres` });
      }

      // Bar colors for genres
      const barColors = [
        "#e94560", "#00b4d8", "#ffd166", "#06d6a0", "#ef476f",
        "#118ab2", "#fca311", "#8338ec", "#ff6b6b", "#48bfe3"
      ];

      return (
        <div className="stats-content">
          <div className="stats-cards">
            <div className="stats-card">
              <div className="stats-card-number">{total}</div>
              <div className="stats-card-label">{itemLabel} ranked</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-number">{wlCount}</div>
              <div className="stats-card-label">on watchlist</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-number">{topGenre}</div>
              <div className="stats-card-label">top genre</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-number">{genreSorted.length}</div>
              <div className="stats-card-label">genres</div>
            </div>
          </div>

          <h4 className="stats-section-title">Genre Breakdown</h4>
          <div className="stats-bar-chart">
            {genreSorted.slice(0, 10).map(([genre, count], i) => (
              <div className="stats-bar-row" key={genre}>
                <div className="stats-bar-label">{genre}</div>
                <div className="stats-bar-track">
                  <div className="stats-bar-fill" style={{
                    width: Math.round((count / maxGenre) * 100) + "%",
                    background: barColors[i % barColors.length],
                    opacity: 0.85
                  }} />
                </div>
                <div className="stats-bar-count">{count}</div>
              </div>
            ))}
          </div>

          <h4 className="stats-section-title">By Decade</h4>
          <div className="stats-bar-chart">
            {decadeSorted.map(([decade, count]) => (
              <div className="stats-bar-row" key={decade}>
                <div className="stats-bar-label">{decade}</div>
                <div className="stats-bar-track">
                  <div className="stats-bar-fill" style={{
                    width: Math.round((count / maxDecade) * 100) + "%"
                  }} />
                </div>
                <div className="stats-bar-count">{count}</div>
              </div>
            ))}
          </div>

          {insights.length > 0 && (
            <>
              <h4 className="stats-section-title">Insights</h4>
              <div className="stats-insights">
                {insights.map((ins, i) => (
                  <div className="stats-insight" key={i}>
                    <span className="stats-insight-icon">{ins.icon}</span>
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    // ─── Toast ──────────────────────────────────────────────────
    function Toast({ message, actionLabel, onAction }) {
      if (!message) return null;
      return (
        <div className="toast">
          <span>{message}</span>
          {actionLabel && onAction && (
            <button className="toast-action" onClick={onAction}>{actionLabel}</button>
          )}
        </div>
      );
    }

    // ─── Share Card ─────────────────────────────────────────────
    // Renders the canvas card off-screen, then hands the resulting blob to the
    // share sheet / clipboard / download. Pre-rendering on open is required,
    // not an optimisation: navigator.share on iOS must be reached from the
    // click handler without an intervening await.
    function ShareCard({ item, user, isPrivate, onClose, onToast, onMakePublic }) {
      var [format, setFormat] = useState(function() {
        try { return localStorage.getItem("movi-share-format") === "story" ? "story" : "feed"; }
        catch (e) { return "feed"; }
      });
      var [previewUrl, setPreviewUrl] = useState(null);
      var [busy, setBusy] = useState(false);
      var [error, setError] = useState(null);
      var blobRef = useRef(null);
      var canvasRef = useRef(null);

      var canShareFiles = typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;
      var canCopyImage = typeof ClipboardItem !== "undefined" &&
        typeof navigator !== "undefined" && !!navigator.clipboard && !!navigator.clipboard.write;

      useEffect(function() {
        function onKey(e) { if (e.key === "Escape") onClose(); }
        if (item) document.addEventListener("keydown", onKey);
        return function() { document.removeEventListener("keydown", onKey); };
      }, [item, onClose]);

      useEffect(function() {
        try { localStorage.setItem("movi-share-format", format); } catch (e) {}
      }, [format]);

      useEffect(function() {
        if (!item) { setPreviewUrl(null); blobRef.current = null; canvasRef.current = null; return; }
        var cancelled = false;
        var url = null;
        setBusy(true);
        setError(null);
        renderShareCard({
          movie: item.movie, rank: item.rank, total: item.total, score: item.score,
          isTV: item.isTV, above: item.above, below: item.below,
          displayName: user ? user.displayName : null, format: format,
        }).then(function(canvas) {
          if (cancelled) return;
          canvasRef.current = canvas;
          // A tainted canvas throws here, which the catch below turns into a
          // visible message rather than a modal stuck on "Building...".
          return new Promise(function(res) { canvas.toBlob(res, "image/jpeg", 0.92); });
        }).then(function(blob) {
          if (cancelled) return;
          if (!blob) { setError("Couldn't build the card. Check your connection and try again."); setBusy(false); return; }
          blobRef.current = blob;
          url = URL.createObjectURL(blob);
          setPreviewUrl(url);
          setBusy(false);
        }).catch(function(e) {
          if (cancelled) return;
          console.error("Share card render failed:", e);
          setError("Couldn't build the card. Check your connection and try again.");
          setBusy(false);
        });
        return function() {
          cancelled = true;
          if (url) URL.revokeObjectURL(url);
        };
      }, [item, format, user]);

      if (!item) return null;

      var caption = buildShareCaption(item, user, isPrivate);
      var fileName = "movirank-" + String(item.movie.title || "card").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + item.rank + ".jpg";

      function shareFile() {
        if (!blobRef.current) return false;
        var file = new File([blobRef.current], fileName, { type: "image/jpeg" });
        // files + text only: passing url as well makes iOS drop the file for
        // some share targets.
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: caption }).catch(function() {});
          return true;
        }
        return false;
      }

      function downloadImage() {
        if (!previewUrl) return;
        var a = document.createElement("a");
        if (!("download" in a)) { window.open(previewUrl, "_blank"); return; }
        a.href = previewUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      function copyCaption() {
        if (!navigator.clipboard) { onToast("Caption: " + caption); return; }
        navigator.clipboard.writeText(caption)
          .then(function() { onToast("Caption copied!"); })
          .catch(function() { onToast("Couldn't copy the caption."); });
      }

      function copyCaptionSilently() {
        if (navigator.clipboard) navigator.clipboard.writeText(caption).catch(function() {});
      }

      function handleInstagram() {
        if (shareFile()) return;
        downloadImage();
        copyCaptionSilently();
        onToast("Image saved & caption copied — post it from Instagram on your phone.", 5000);
      }

      function handleX() {
        // The share sheet is the only route that carries the image into the
        // installed X app. The web intent opens a logged-out browser session
        // instead of handing off, and twitter:// URLs cannot attach a file —
        // so on mobile the sheet wins, and the intent is the desktop fallback.
        if (shareFile()) return;
        downloadImage();
        copyCaptionSilently();
        window.open("https://x.com/intent/post?text=" + encodeURIComponent(caption), "_blank", "noopener");
        onToast("Image saved — attach it in the X composer.", 5000);
      }

      function handleCopyImage() {
        if (!canvasRef.current) return;
        // The promise must be handed to ClipboardItem synchronously or Safari
        // treats the write as detached from the user gesture.
        var png = new Promise(function(res) { canvasRef.current.toBlob(res, "image/png"); });
        navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
          .then(function() { onToast("Image copied to clipboard!"); })
          .catch(function() { onToast("Couldn't copy the image — try Download."); });
      }

      return (
        <div className="sharecard-overlay" onClick={onClose}>
          <div className="sharecard-modal" onClick={function(e) { e.stopPropagation(); }}>
            <button className="sharecard-close" onClick={onClose} aria-label="Close">&times;</button>
            <h3 className="sharecard-title">Share your ranking</h3>

            <div className="sharecard-formats">
              <button className={"sharecard-pill" + (format === "feed" ? " active" : "")}
                onClick={function() { setFormat("feed"); }}>Feed 4:5</button>
              <button className={"sharecard-pill" + (format === "story" ? " active" : "")}
                onClick={function() { setFormat("story"); }}>Story 9:16</button>
            </div>

            <div className={"sharecard-preview" + (format === "story" ? " story" : "")}>
              {error ? (
                <div className="sharecard-status">{error}</div>
              ) : previewUrl ? (
                <img src={previewUrl} alt={item.movie.title + " ranked #" + item.rank} />
              ) : (
                <div className="sharecard-status">Building your card&hellip;</div>
              )}
            </div>

            {user && isPrivate && (
              <div className="sharecard-note">
                Your rankings are private, so the caption links to the homepage instead of your list.
                {onMakePublic && (
                  <button className="sharecard-note-btn" onClick={onMakePublic}>Make public</button>
                )}
              </div>
            )}
            {!user && (
              <div className="sharecard-note">
                Sign in to link followers straight to your own ranked list.
              </div>
            )}

            <div className="sharecard-actions">
              {canShareFiles && (
                <button className="sharecard-btn primary" disabled={busy || !previewUrl}
                  onClick={function() { if (!shareFile()) handleInstagram(); }}>
                  <span>&#x2934;</span> Share
                </button>
              )}
              <button className="sharecard-btn ig" disabled={busy || !previewUrl} onClick={handleInstagram}>
                <span>&#x1F4F7;</span> {canShareFiles ? "Instagram" : "Save for Instagram"}
              </button>
              <button className="sharecard-btn" disabled={busy || !previewUrl} onClick={handleX}>
                <span>&#x1D54F;</span> Post on X
              </button>
              <button className="sharecard-btn" disabled={busy || !previewUrl} onClick={downloadImage}>
                <span>&#x2B07;</span> Download
              </button>
              {canCopyImage && (
                <button className="sharecard-btn" disabled={busy || !previewUrl} onClick={handleCopyImage}>
                  <span>&#x1F5BC;</span> Copy image
                </button>
              )}
              <button className="sharecard-btn" onClick={copyCaption}>
                <span>&#x1F4CB;</span> Copy caption
              </button>
            </div>

            <div className="sharecard-caption">{caption}</div>
          </div>
        </div>
      );
    }

    function MovieDetail({ movie, onClose, onRerank, onRemove, rankedList, isTV, onShareCard }) {
      var [tmdbDetail, setTmdbDetail] = useState(null);
      var [detailLoading, setDetailLoading] = useState(false);

      // Close on Escape
      useEffect(function() {
        if (!movie) return;
        function handleKey(e) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", handleKey);
        return function() { document.removeEventListener("keydown", handleKey); };
      }, [movie && movie.id]);

      // Fetch TMDB details when movie changes
      useEffect(function() {
        if (!movie || !TMDB_API_KEY) { setTmdbDetail(null); return; }
        // Only fetch for real TMDB IDs (not custom entries)
        if (typeof movie.id === "string" && movie.id.indexOf("custom_") === 0) { setTmdbDetail(null); return; }

        var cancelled = false;
        setDetailLoading(true);
        setTmdbDetail(null);
        var type = isTV ? "tv" : "movie";
        var detailUrl = "https://api.themoviedb.org/3/" + type + "/" + movie.id + "?api_key=" + TMDB_API_KEY + "&language=en-US&append_to_response=credits";

        fetch(detailUrl).then(function(r) { return r.json(); }).then(function(data) {
          if (cancelled) return; // a newer movie was opened; drop this stale response
          var director = "";
          var cast = [];
          if (data.credits) {
            // For movies, director is in crew. For TV, use "created_by" or first crew with "Director"
            var crew = data.credits.crew || [];
            var dirEntry = crew.find(function(c) { return c.job === "Director"; });
            if (dirEntry) {
              director = dirEntry.name;
            } else if (data.created_by && data.created_by.length > 0) {
              director = data.created_by.map(function(c) { return c.name; }).join(", ");
            }
            cast = (data.credits.cast || []).slice(0, 5).map(function(c) { return c.name; });
          }
          setTmdbDetail({
            overview: data.overview || "",
            director: director,
            cast: cast,
            tmdbRating: data.vote_average || null,
            runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]) || null,
            seasons: data.number_of_seasons || null,
          });
          setDetailLoading(false);
        }).catch(function() { if (!cancelled) setDetailLoading(false); });
        return function() { cancelled = true; };
      }, [movie && movie.id, isTV]);

      if (!movie) return null;
      var rankIndex = rankedList ? rankedList.findIndex(function(m) { return m.id === movie.id; }) : -1;
      var isRanked = rankIndex >= 0;
      var score = isRanked ? getScore(rankIndex, rankedList.length) : null;
      return (
        <div className="movie-detail-overlay" onClick={onClose}>
          <div className="movie-detail-box" onClick={e => e.stopPropagation()}>
            <button className="movie-detail-close" onClick={onClose}>&#x2715;</button>
            <Poster poster={movie.poster} title={movie.title}
              className={movie.poster ? "" : "poster-placeholder"}
              style={{width:"100%",aspectRatio:"2/3",objectFit:"cover",display:"block",borderRadius:0}} />
            <div className="movie-detail-info">
              <div className="movie-detail-title">{movie.title}</div>
              <div className="movie-detail-year">
                {[
                  movie.year,
                  movie.genre,
                  tmdbDetail && tmdbDetail.runtime ? `${tmdbDetail.runtime}m` : null,
                  tmdbDetail && tmdbDetail.seasons ? `${tmdbDetail.seasons} season${tmdbDetail.seasons > 1 ? "s" : ""}` : null,
                ].filter(Boolean).join(" \u00b7 ")}
              </div>
              {tmdbDetail && tmdbDetail.tmdbRating && (
                <div className="movie-detail-rating">
                  <span className="tmdb-star">&#x2605;</span> {tmdbDetail.tmdbRating.toFixed(1)}/10
                </div>
              )}
              {isRanked && (
                <div className="movie-detail-rank">
                  Ranked <strong>#{rankIndex + 1}</strong> of {rankedList.length}
                  {" \u00b7 "}
                  <span className={scoreClass(score)}><strong>{score.toFixed(1)}</strong></span>
                </div>
              )}
              {detailLoading && <div className="movie-detail-loading">Loading details...</div>}
              {tmdbDetail && tmdbDetail.overview && (
                <div className="movie-detail-overview">{tmdbDetail.overview}</div>
              )}
              {tmdbDetail && (tmdbDetail.director || tmdbDetail.cast.length > 0) && (
                <div className="movie-detail-meta">
                  {tmdbDetail.director && (
                    <div className="movie-detail-meta-row">
                      <span className="movie-detail-meta-label">{isTV ? "Created by" : "Director"}</span>
                      {tmdbDetail.director}
                    </div>
                  )}
                  {tmdbDetail.cast.length > 0 && (
                    <div className="movie-detail-meta-row">
                      <span className="movie-detail-meta-label">Cast</span>
                      {tmdbDetail.cast.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
            {isRanked && onRerank && (
              <div className="movie-detail-actions">
                {onShareCard && (
                  <button className="movie-detail-sharecard" onClick={function() { onShareCard(movie, isTV); onClose(); }}>
                    Share card
                  </button>
                )}
                <button className="movie-detail-rerank" onClick={function() { onRerank(movie); onClose(); }}>
                  Re-rank
                </button>
                <button className="movie-detail-remove" onClick={function() { onRemove(movie.id); onClose(); }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ─── App ────────────────────────────────────────────────────
    function App() {
      const [mode, setMode] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get("type") === "tv" ? "tv" : "movies";
      });
      const [dayMode, setDayMode] = useState(() => localStorage.getItem("movi-daymode") === "true");
      const [isPrivate, setIsPrivate] = useState(() => localStorage.getItem("movi-private") === "true");
      const [rankedList, setRankedList] = useState(() => {
        try { return JSON.parse(localStorage.getItem("movi-ranked-list")) || []; } catch { return []; }
      });
      const [tvRankedList, setTvRankedList] = useState(() => {
        try { return JSON.parse(localStorage.getItem("movi-tv-ranked-list")) || []; } catch { return []; }
      });
      const [watchlist, setWatchlist] = useState(() => {
        try { return JSON.parse(localStorage.getItem("movi-watchlist")) || []; } catch { return []; }
      });
      const [tvWatchlist, setTvWatchlist] = useState(() => {
        try { return JSON.parse(localStorage.getItem("movi-tv-watchlist")) || []; } catch { return []; }
      });
      const [session, setSession] = useState(null);
      const [tvSession, setTvSession] = useState(null);
      const [toast, setToast] = useState("");
      // The ranking that just completed, offered via the toast action pill.
      const [justRanked, setJustRanked] = useState(null);
      // Non-null while the share modal is open; same shape as justRanked.
      const [shareCard, setShareCard] = useState(null);
      const [detailMovie, setDetailMovie] = useState(null);
      const [showImport, setShowImport] = useState(false);
      const [user, setUser] = useState(null);
      const [authLoading, setAuthLoading] = useState(FIREBASE_READY);
      const [authMode, setAuthMode] = useState(null); // null, "signin", "signup"
      const [authEmail, setAuthEmail] = useState("");
      const [authPassword, setAuthPassword] = useState("");
      const [authDisplayName, setAuthDisplayName] = useState("");
      const [authError, setAuthError] = useState("");
      const [tab, setTab] = useState("rank"); // "rank", "community"
      const [viewingUid, setViewingUid] = useState(null);
      const [statsOpen, setStatsOpen] = useState(false);
      const saveTimerRef = useRef(null);
      const syncedRef = useRef(false);
      const toastTimerRef = useRef(null);

      const isTV = mode === "tv";
      const activeList = isTV ? tvRankedList : rankedList;
      const setActiveList = isTV ? setTvRankedList : setRankedList;
      const activeSession = isTV ? tvSession : session;
      const setActiveSession = isTV ? setTvSession : setSession;
      const rankedIds = new Set(rankedList.map(m => m.id));
      const tvRankedIds = new Set(tvRankedList.map(m => m.id));
      const activeIds = isTV ? tvRankedIds : rankedIds;
      const activeWatchlist = isTV ? tvWatchlist : watchlist;
      const setActiveWatchlist = isTV ? setTvWatchlist : setWatchlist;
      const watchlistIds = new Set(watchlist.map(m => m.id));
      const tvWatchlistIds = new Set(tvWatchlist.map(m => m.id));
      const activeWatchlistIds = isTV ? tvWatchlistIds : watchlistIds;

      // Apply theme to body background. Only set background-color — setting the
      // `background` shorthand inline would override the stylesheet's
      // background-image gradients (hero glow, day-mode wash).
      useEffect(() => {
        document.body.style.background = "";
        document.body.style.backgroundColor = dayMode
          ? (isTV ? "#F5FAF7" : "#FBF7F0")
          : (isTV ? "#0D120F" : "#0F0E0D");
      }, [isTV, dayMode]);

      // Persist day mode preference
      useEffect(() => {
        localStorage.setItem("movi-daymode", dayMode);
      }, [dayMode]);

      // Backfill TMDB ratings for movies/shows missing them
      async function backfillRatings(list, setList, type) {
        // Clean up any "Critically Acclaimed" that was previously appended to genres
        const needsCleanup = list.some(m => m.genre && m.genre.includes("Critically Acclaimed"));
        if (needsCleanup) {
          setList(prev => prev.map(m => m.genre && m.genre.includes("Critically Acclaimed")
            ? { ...m, genre: m.genre.replace(/, Critically Acclaimed/g, "").replace(/Critically Acclaimed,?\s*/g, "").trim() }
            : m
          ));
        }

        // Custom entries have no TMDB id — fetching them would 404 on every load
        const needsRating = list.filter(m => m.rating == null
          && !(typeof m.id === "string" && m.id.indexOf("custom_") === 0));
        console.log("[Backfill]", type, "needs rating:", needsRating.length, "of", list.length);

        // Fetch ratings for movies that don't have them yet
        if (needsRating.length === 0) return;
        const endpoint = type === "tv" ? "tv" : "movie";
        const fetches = needsRating.map(async m => {
          try {
            const resp = await fetch(`https://api.themoviedb.org/3/${endpoint}/${m.id}?api_key=${TMDB_API_KEY}`);
            if (!resp.ok) return { id: m.id, rating: null };
            const data = await resp.json();
            return { id: m.id, rating: data.vote_average || null };
          } catch(e) { return { id: m.id, rating: null }; }
        });
        const results = await Promise.all(fetches);
        const ratingMap = {};
        results.forEach(r => { ratingMap[r.id] = r.rating; });
        setList(prev => prev.map(m => {
          if (m.rating != null) return m;
          const r = ratingMap[m.id];
          return { ...m, rating: r };
        }));
      }

      // Check URL for shared profile
      useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const sharedUid = params.get("u");
        if (sharedUid && FIREBASE_READY) {
          setViewingUid(sharedUid);
        }
        if (params.get("type") === "tv") setMode("tv");
      }, []);

      // Firebase auth listener
      useEffect(() => {
        if (!auth) return;
        const unsub = auth.onAuthStateChanged(async (firebaseUser) => {
          syncedRef.current = false;
          setUser(firebaseUser);
          setAuthLoading(false);
          if (firebaseUser) {
            const profile = await loadProfile(firebaseUser.uid);
            if (profile) {
              // Sync movies
              if (profile.movies && profile.movies.length > 0) {
                const localList = JSON.parse(localStorage.getItem("movi-ranked-list") || "[]");
                if (localList.length === 0 || profile.movieCount > localList.length) {
                  setRankedList(profile.movies);
                }
              }
              // Sync TV shows
              if (profile.tvShows && profile.tvShows.length > 0) {
                const localTvList = JSON.parse(localStorage.getItem("movi-tv-ranked-list") || "[]");
                if (localTvList.length === 0 || profile.tvShowCount > localTvList.length) {
                  setTvRankedList(profile.tvShows);
                }
              }
              // Sync watchlists
              if (profile.watchlist && profile.watchlist.length > 0) {
                const localWl = JSON.parse(localStorage.getItem("movi-watchlist") || "[]");
                if (localWl.length === 0 || profile.watchlistCount > localWl.length) {
                  setWatchlist(profile.watchlist);
                }
              }
              if (profile.tvWatchlist && profile.tvWatchlist.length > 0) {
                const localTvWl = JSON.parse(localStorage.getItem("movi-tv-watchlist") || "[]");
                if (localTvWl.length === 0 || profile.tvWatchlistCount > localTvWl.length) {
                  setTvWatchlist(profile.tvWatchlist);
                }
              }
            }
            // Sync private mode setting
            if (profile && profile.isPrivate !== undefined) {
              setIsPrivate(!!profile.isPrivate);
              localStorage.setItem("movi-private", profile.isPrivate ? "true" : "false");
            }
            // Backfill ratings after Firestore sync
            const movieList = (profile && profile.movies && profile.movies.length > 0) ? profile.movies : rankedList;
            const tvList = (profile && profile.tvShows && profile.tvShows.length > 0) ? profile.tvShows : tvRankedList;
            backfillRatings(movieList, setRankedList, "movie");
            backfillRatings(tvList, setTvRankedList, "tv");
            syncedRef.current = true;
          } else {
            // Not signed in — backfill from localStorage
            backfillRatings(rankedList, setRankedList, "movie");
            backfillRatings(tvRankedList, setTvRankedList, "tv");
          }
        });
        return () => unsub();
      }, []);

      // Handle redirect result
      useEffect(() => {
        if (!auth) return;
        auth.getRedirectResult().then(result => {
          if (result && result.user) {
            showToast("Signed in! Your rankings will sync to the cloud.");
          }
        }).catch(e => console.error("Redirect sign-in error:", e));
      }, []);

      // Save to localStorage
      useEffect(() => {
        localStorage.setItem("movi-ranked-list", JSON.stringify(rankedList));
      }, [rankedList]);
      useEffect(() => {
        localStorage.setItem("movi-tv-ranked-list", JSON.stringify(tvRankedList));
      }, [tvRankedList]);
      useEffect(() => {
        localStorage.setItem("movi-watchlist", JSON.stringify(watchlist));
      }, [watchlist]);
      useEffect(() => {
        localStorage.setItem("movi-tv-watchlist", JSON.stringify(tvWatchlist));
      }, [tvWatchlist]);

      // Debounced save to Firestore (saves all lists)
      // Only saves after initial Firestore sync is complete to prevent overwriting cloud data
      useEffect(() => {
        if (!user || !db || !syncedRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveProfile(user, rankedList, tvRankedList, watchlist, tvWatchlist, isPrivate);
        }, 1500);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
      }, [rankedList, tvRankedList, watchlist, tvWatchlist, user, isPrivate]);

      function undoLastImport() {
        const backup = localStorage.getItem("movi-import-backup");
        if (!backup) { showToast("No import to undo"); return; }
        let restored;
        try { restored = JSON.parse(backup); } catch { restored = null; }
        if (!Array.isArray(restored)) { showToast("Import backup is corrupted — cannot undo."); return; }
        setRankedList(restored);
        localStorage.removeItem("movi-import-backup");
        localStorage.removeItem("movi-import-backup-time");
        showToast("Rankings restored to pre-import state!");
      }

      function handleLetterboxdImport(movies, mode, moviesWithRatings) {
        // Backup current rankings before any import
        localStorage.setItem("movi-import-backup", JSON.stringify(rankedList));
        localStorage.setItem("movi-import-backup-time", Date.now().toString());
        if (mode === "replace") {
          setRankedList(movies);
          showToast(`Imported ${movies.length} movies from Letterboxd!`);
        } else {
          // Merge: keep existing, interleave new movies by Letterboxd rating
          const existingIds = new Set(rankedList.map(m => m.id));
          const newMovies = moviesWithRatings.filter(m => !existingIds.has(m.id));
          if (newMovies.length === 0) {
            showToast("All movies already in your rankings!");
            setShowImport(false);
            return;
          }
          // Snapshot original scores so insertions don't shift them
          const originalLen = rankedList.length;
          const originalScores = rankedList.map((m, i) => ({
            movie: m,
            score: getScore(i, originalLen)
          }));
          // Map new movies to score entries too
          const newEntries = newMovies.map(m => ({
            movie: { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, rating: m.rating },
            score: m._lbRating * 2 // Map 0.5-5.0 to 1.0-10.0
          }));
          // Combine and sort by score descending (higher score = higher rank)
          const all = originalScores.concat(newEntries);
          all.sort((a, b) => b.score - a.score);
          let merged = all.map(e => e.movie);
          setRankedList(merged);
          showToast(`Merged ${newMovies.length} new movies from Letterboxd!`);
        }
        setShowImport(false);
      }

      function handleTogglePrivate() {
        const next = !isPrivate;
        setIsPrivate(next);
        localStorage.setItem("movi-private", next ? "true" : "false");
        showToast(next ? "Rankings set to private" : "Rankings set to public");
      }

      // The share offer lives and dies with its toast: any later toast clears
      // it, so an unrelated message can never resurrect a stale "Share" pill.
      function showToast(msg, ms, share) {
        setToast(msg);
        setJustRanked(share || null);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => { setToast(""); setJustRanked(null); }, ms || 2500);
      }

      // `list` must be the post-splice array and `index` the insert index —
      // scores are positional, so they only settle once the item is in place.
      function rankPayload(movie, list, index, useTV) {
        const total = list.length;
        return {
          movie, rank: index + 1, total, score: getScore(index, total), isTV: useTV,
          above: index > 0 ? list[index - 1] : null,
          below: index < total - 1 ? list[index + 1] : null,
        };
      }

      function handleActivityMovieClick(evMovie, evIsTV) {
        var list = evIsTV ? tvRankedList : rankedList;
        var mine = list.find(function(m) { return m.id === evMovie.id; });
        if (evIsTV !== isTV) setMode(evIsTV ? "tv" : "movies");
        setDetailMovie(mine || evMovie);
      }

      // Builds the same payload for a title that was ranked earlier.
      function openShareCardFor(movie, useTV) {
        const list = useTV ? tvRankedList : rankedList;
        const idx = list.findIndex(m => m.id === movie.id);
        if (idx === -1) { showToast("Rank it first to make a share card!"); return; }
        const total = list.length;
        setShareCard({
          movie: list[idx], rank: idx + 1, total, score: getScore(idx, total), isTV: useTV,
          above: idx > 0 ? list[idx - 1] : null,
          below: idx < total - 1 ? list[idx + 1] : null,
        });
      }

      async function handleSignIn() {
        if (!auth) return;
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          // Try popup first, fall back to redirect for browsers that block popups
          try {
            await auth.signInWithPopup(provider);
            showToast("Signed in! Your rankings will sync to the cloud.");
          } catch (popupErr) {
            if (popupErr.code === "auth/popup-blocked" ||
                popupErr.code === "auth/popup-closed-by-user" ||
                popupErr.code === "auth/cancelled-popup-request") {
              // Fall back to redirect method (works on all browsers)
              await auth.signInWithRedirect(provider);
            } else {
              throw popupErr;
            }
          }
        } catch (e) {
          showToast("Sign-in failed. Please try again.");
          console.error("Sign-in error:", e);
        }
      }

      async function handleSignOut() {
        if (!auth) return;
        await auth.signOut();
        showToast("Signed out.");
      }

      function getAuthErrorMessage(code) {
        const msgs = {
          "auth/email-already-in-use": "An account with this email already exists.",
          "auth/weak-password": "Password must be at least 6 characters.",
          "auth/invalid-email": "Please enter a valid email address.",
          "auth/user-not-found": "No account found with this email.",
          "auth/wrong-password": "Incorrect password.",
          "auth/invalid-credential": "Incorrect email or password.",
          "auth/too-many-requests": "Too many attempts. Please try again later.",
        };
        return msgs[code] || "Something went wrong. Please try again.";
      }

      async function handleEmailSignIn() {
        if (!auth) return;
        setAuthError("");
        if (!authEmail || !authPassword) {
          setAuthError("Please enter both email and password.");
          return;
        }
        try {
          // Check if this email is only associated with Google
          const methods = await auth.fetchSignInMethodsForEmail(authEmail);
          if (methods.length > 0 && !methods.includes("password") && methods.includes("google.com")) {
            setAuthError("This email uses Google sign-in. Please use the 'Sign in with Google' button instead.");
            return;
          }
          await auth.signInWithEmailAndPassword(authEmail, authPassword);
          setAuthMode(null);
          setAuthEmail(""); setAuthPassword("");
          showToast("Signed in! Your rankings will sync to the cloud.");
        } catch (e) {
          setAuthError(getAuthErrorMessage(e.code));
        }
      }

      async function handleEmailSignUp() {
        if (!auth) return;
        setAuthError("");
        if (!authDisplayName.trim()) {
          setAuthError("Please enter a display name.");
          return;
        }
        if (!authEmail || !authPassword) {
          setAuthError("Please enter both email and password.");
          return;
        }
        try {
          // Check if this email is already used (e.g. via Google sign-in)
          const methods = await auth.fetchSignInMethodsForEmail(authEmail);
          if (methods.length > 0) {
            if (methods.includes("google.com")) {
              setAuthError("An account with this email already exists. Please sign in with Google instead.");
            } else {
              setAuthError("An account with this email already exists. Try signing in instead.");
            }
            return;
          }
          const cred = await auth.createUserWithEmailAndPassword(authEmail, authPassword);
          await cred.user.updateProfile({ displayName: authDisplayName.trim() });
          // Force refresh so displayName is available immediately
          setUser({...cred.user, displayName: authDisplayName.trim()});
          setAuthMode(null);
          setAuthEmail(""); setAuthPassword(""); setAuthDisplayName("");
          showToast("Account created! Your rankings will sync to the cloud.");
        } catch (e) {
          setAuthError(getAuthErrorMessage(e.code));
        }
      }

      function handleShare() {
        if (!user) {
          showToast("Sign in to share your rankings!");
          return;
        }
        let url = window.location.origin + window.location.pathname + "?u=" + user.uid;
        if (isTV) url += "&type=tv";
        navigator.clipboard.writeText(url).then(() => {
          showToast("Share link copied to clipboard!");
        }).catch(() => {
          showToast("Share URL: " + url);
        });
      }

      function handleAddToWatchlistFromComparison() {
        // Add the movie being compared to watchlist instead of ranking
        const s = activeSession;
        if (!s) return;
        setActiveSession(null);
        handleAddToWatchlist(s.newMovie);
      }

      function handleAddToWatchlist(movie, forceType) {
        const useTV = forceType ? forceType === "tv" : isTV;
        const targetWl = useTV ? tvWatchlist : watchlist;
        const targetSetWl = useTV ? setTvWatchlist : setWatchlist;
        const targetWlIds = useTV ? tvWatchlistIds : watchlistIds;
        const targetRankedIds = useTV ? tvRankedIds : rankedIds;

        if (targetWlIds.has(movie.id)) {
          showToast(`"${movie.title}" is already on your watchlist!`);
          return;
        }
        if (targetRankedIds.has(movie.id)) {
          showToast(`"${movie.title}" is already ranked!`);
          return;
        }
        if (forceType && forceType !== mode) {
          setMode(forceType);
        }
        targetSetWl(prev => [...prev, movie]);
        showToast(`"${movie.title}" added to watchlist!`);
      }

      function handleRemoveFromWatchlist(id) {
        setActiveWatchlist(prev => prev.filter(m => m.id !== id));
      }

      // A movie that just got ranked should no longer sit on the watchlist
      function removeFromWatchlistById(id, useTV) {
        const setWl = useTV ? setTvWatchlist : setWatchlist;
        setWl(prev => prev.filter(m => m.id !== id));
      }

      function handleWatchedIt(movie) {
        // Keep it on the watchlist until ranking actually completes,
        // so cancelling the comparison doesn't lose the item.
        handleSelectMovie(movie);
      }

      function handleSelectMovie(movie, forceType) {
        // If forceType is specified (from friend profile), use that list instead of current mode
        const useTV = forceType ? forceType === "tv" : isTV;
        const targetList = useTV ? tvRankedList : rankedList;
        const targetSetList = useTV ? setTvRankedList : setRankedList;
        const targetIds = useTV ? tvRankedIds : rankedIds;
        const targetSetSession = useTV ? setTvSession : setSession;

        if (targetIds.has(movie.id)) {
          // Already ranked — make sure it isn't lingering on the watchlist too
          removeFromWatchlistById(movie.id, useTV);
          showToast(`"${movie.title}" is already ranked!`);
          return;
        }

        // Switch mode to match the type being added
        if (forceType && forceType !== mode) {
          setMode(forceType);
        }

        if (targetList.length === 0) {
          targetSetList([movie]);
          removeFromWatchlistById(movie.id, useTV);
          const score = getScore(0, 1);
          showToast(`"${movie.title}" added as #1 (${score.toFixed(1)})!`, 5000, rankPayload(movie, [movie], 0, useTV));
          return;
        }
        const s = createSession(movie, targetList);
        // Store type in session so handleChoice uses the correct list
        s._isTV = useTV;
        if (s.done) {
          const newList = [...targetList];
          newList.splice(s.insertIndex, 0, movie);
          targetSetList(newList);
          removeFromWatchlistById(movie.id, useTV);
          const score = getScore(s.insertIndex, newList.length);
          showToast(`"${movie.title}" ranked #${s.insertIndex + 1} (${score.toFixed(1)})!`, 5000, rankPayload(movie, newList, s.insertIndex, useTV));
        } else {
          targetSetSession(s);
        }
      }

      function handleRerank(movie) {
        // Remove from current list, then re-insert via binary search
        const useTV = isTV;
        const targetList = useTV ? tvRankedList : rankedList;
        const targetSetList = useTV ? setTvRankedList : setRankedList;
        const targetSetSession = useTV ? setTvSession : setSession;

        // Remove movie from the list
        // Build the session against the list minus this title, but deliberately
        // do NOT commit that removal to state. A transient shorter list gets
        // picked up by the debounced profile save, and the later re-insert then
        // looks like a brand new ranking to saveProfile's count comparison —
        // which spammed the activity feed even when the user cancelled.
        const filtered = targetList.filter(function(m) { return m.id !== movie.id; });

        if (filtered.length === 0) {
          showToast("\"" + movie.title + "\" is your only ranked " + (useTV ? "show" : "movie") + ".");
          return;
        }

        // Start fresh binary search on the filtered list
        var s = createSession(movie, filtered);
        s._isTV = useTV;
        // The old copy is still in state, so completion has to drop it before
        // inserting at the new index.
        s._rerankId = movie.id;
        if (s.done) {
          var newList = filtered.slice();
          newList.splice(s.insertIndex, 0, movie);
          targetSetList(newList);
          var score = getScore(s.insertIndex, newList.length);
          showToast("\"" + movie.title + "\" re-ranked #" + (s.insertIndex + 1) + " (" + score.toFixed(1) + ")!", 5000, rankPayload(movie, newList, s.insertIndex, useTV));
        } else {
          targetSetSession(s);
        }
      }

      function handleCancelSession() {
        var s = activeSession;
        // Nothing was ever removed, so cancelling a re-rank needs no restore.
        if (s && s._rerankId != null) {
          showToast("\"" + s.newMovie.title + "\" kept at its original rank.");
        }
        setJustRanked(null);
        setActiveSession(null);
      }

      function handleCantDecide() {
        if (!activeSession) return;
        var preferNew = Math.random() < 0.5;
        var pickedTitle = preferNew ? activeSession.newMovie.title : activeSession.compareMovie.title;
        handleChoice(preferNew);
        showToast("Coin flip! \uD83C\uDFB2 Picked \"" + pickedTitle + "\"");
      }

      function handleChoice(preferNew) {
        // Use the session's stored type to ensure correct list is used
        const sessionIsTV = activeSession._isTV !== undefined ? activeSession._isTV : isTV;
        const choiceList = sessionIsTV ? tvRankedList : rankedList;
        const choiceSetList = sessionIsTV ? setTvRankedList : setRankedList;
        const choiceSetSession = sessionIsTV ? setTvSession : setSession;

        const next = recordChoice(activeSession, preferNew);
        next._isTV = sessionIsTV; // preserve type through comparisons
        if (next.done) {
          // On a re-rank the old copy is still in the list; insertIndex is an
          // index into the list without it.
          const base = next._rerankId != null
            ? choiceList.filter(function(m) { return m.id !== next._rerankId; })
            : choiceList;
          const newList = [...base];
          newList.splice(next.insertIndex, 0, next.newMovie);
          choiceSetList(newList);
          removeFromWatchlistById(next.newMovie.id, sessionIsTV);
          const score = getScore(next.insertIndex, newList.length);
          showToast(`"${next.newMovie.title}" ranked #${next.insertIndex + 1} (${score.toFixed(1)})!`, 5000, rankPayload(next.newMovie, newList, next.insertIndex, sessionIsTV));
          choiceSetSession(null);
        } else {
          choiceSetSession(next);
        }
      }

      function handleRemove(id) { setActiveList(prev => prev.filter(m => m.id !== id)); }
      function handleClear() { setActiveList([]); }
      function handleMove(draggedId, beforeId) {
        setActiveList(function(prev) {
          var next = prev.slice();
          var fromIdx = -1;
          for (var fi = 0; fi < next.length; fi++) {
            if (next[fi].id === draggedId) { fromIdx = fi; break; }
          }
          if (fromIdx === -1) return prev;
          var item = next.splice(fromIdx, 1)[0];
          if (beforeId === null) {
            next.push(item);
            return next;
          }
          var toIdx = -1;
          for (var ti = 0; ti < next.length; ti++) {
            if (next[ti].id === beforeId) { toIdx = ti; break; }
          }
          if (toIdx === -1) {
            next.push(item);
            return next;
          }
          next.splice(toIdx, 0, item);
          return next;
        });
      }

      function handleViewProfile(uid) {
        setViewingUid(uid);
        setTab("community");
      }

      function handleBackFromProfile() {
        setViewingUid(null);
        const url = new URL(window.location);
        url.searchParams.delete("u");
        url.searchParams.delete("type");
        window.history.replaceState({}, "", url);
      }

      function handleGoHome() {
        setViewingUid(null);
        setTab("rank");
        const url = new URL(window.location);
        url.searchParams.delete("u");
        url.searchParams.delete("type");
        window.history.replaceState({}, "", url);
      }

      // If viewing someone else's profile
      if (viewingUid && FIREBASE_READY) {
        // Don't show their own profile as a "shared" view
        if (user && viewingUid === user.uid) {
          handleBackFromProfile();
        } else {
          return (
            <div className={`${isTV ? "tv-mode" : ""} ${dayMode ? "day-mode" : ""}`}>
              <button className="theme-toggle" onClick={() => setDayMode(d => !d)} title={dayMode ? "Night mode" : "Day mode"}>
                {dayMode ? "🌙" : "☀️"}
              </button>
              <div className="header">
                <div className="logo-strip" onClick={handleGoHome}>
                  <div className="logo-frame"><span className="sprocket sprocket-top"></span><span className="frame-num">3</span><span className="sprocket sprocket-bot"></span></div>
                  <div className="logo-frame active"><span className="sprocket sprocket-top"></span><span className="frame-num">1</span><span className="sprocket sprocket-bot"></span></div>
                  <div className="logo-frame"><span className="sprocket sprocket-top"></span><span className="frame-num">2</span><span className="sprocket sprocket-bot"></span></div>
                </div>
                <div className="logo-wordmark">MOVI</div>
                <div className="logo-tv-sub">Television</div>
                <p>{isTV ? "TV show" : "Movie"} rankings</p>
              </div>
              <AuthBar user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} authLoading={authLoading}
                authMode={authMode} setAuthMode={setAuthMode}
                authEmail={authEmail} setAuthEmail={setAuthEmail}
                authPassword={authPassword} setAuthPassword={setAuthPassword}
                authDisplayName={authDisplayName} setAuthDisplayName={setAuthDisplayName}
                authError={authError} onEmailSignIn={handleEmailSignIn} onEmailSignUp={handleEmailSignUp} />
              <ProfileView uid={viewingUid} onBack={handleBackFromProfile} onAddMovie={handleSelectMovie}
                onBookmark={handleAddToWatchlist}
                rankedIds={rankedIds} tvRankedIds={tvRankedIds}
                watchlistIds={watchlistIds} tvWatchlistIds={tvWatchlistIds}
                defaultTab={isTV ? "tv" : "movies"}
                isAdmin={user && user.uid === ADMIN_UID}
                onTabChange={(tab) => setMode(tab === "tv" ? "tv" : "movies")}
                onMovieClick={setDetailMovie} />
              <ComparisonView session={activeSession} onChoice={handleChoice} onCancel={handleCancelSession}
                onWatchlist={handleAddToWatchlistFromComparison}
                onSkip={handleCantDecide}
                itemLabel={isTV ? "TV show" : "movie"} />
              <MovieDetail movie={detailMovie} onClose={() => setDetailMovie(null)}
                onRerank={handleRerank} onRemove={handleRemove} rankedList={activeList} isTV={isTV}
                onShareCard={openShareCardFor} />
              <ShareCard item={shareCard} user={user} isPrivate={isPrivate}
                onClose={() => setShareCard(null)} onToast={showToast}
                onMakePublic={isPrivate ? handleTogglePrivate : null} />
              <Toast message={toast}
                actionLabel={justRanked ? "Share \u2197" : null}
                onAction={() => setShareCard(justRanked)} />
              <footer style={{textAlign:"center",padding:"40px 0 20px",opacity:0.5}}>
                <div style={{color:"var(--text-muted)",fontSize:"12px",marginBottom:"8px"}}>a website by Axel Hufford &middot; <a href="https://axelhufford.com" target="_blank" rel="noopener noreferrer" style={{color:"var(--text-muted)"}}>axelhufford.com</a></div>
                <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:"8px",color:"var(--text-muted)",textDecoration:"none",fontSize:"12px"}}>
                  <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg" alt="TMDB" style={{height:"16px"}} />
                  Data provided by TMDB
                </a>
              </footer>
            </div>
          );
        }
      }

      return (
        <div className={`${isTV ? "tv-mode" : ""} ${dayMode ? "day-mode" : ""}`}>
          <button className="theme-toggle" onClick={() => setDayMode(d => !d)} title={dayMode ? "Night mode" : "Day mode"}>
            {dayMode ? "🌙" : "☀️"}
          </button>
          <div className="header">
            <div className="logo-strip" onClick={handleGoHome}>
                  <div className="logo-frame"><span className="sprocket sprocket-top"></span><span className="frame-num">3</span><span className="sprocket sprocket-bot"></span></div>
                  <div className="logo-frame active"><span className="sprocket sprocket-top"></span><span className="frame-num">1</span><span className="sprocket sprocket-bot"></span></div>
                  <div className="logo-frame"><span className="sprocket sprocket-top"></span><span className="frame-num">2</span><span className="sprocket sprocket-bot"></span></div>
                </div>
                <div className="logo-wordmark">MOVI</div>
                <div className="logo-tv-sub">Television</div>
            <p>Every {isTV ? "TV show" : "movie"} ranked, one matchup at a time.</p>
          </div>

          <div className="mode-toggle">
            <button className={`mode-btn ${!isTV ? "active" : ""}`} onClick={() => setMode("movies")}>
              &#x1F3AC; Movies
            </button>
            <button className={`mode-btn ${isTV ? "active" : ""}`} onClick={() => setMode("tv")}>
              &#x1F4FA; TV Shows
            </button>
          </div>

          <AuthBar user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} authLoading={authLoading}
                authMode={authMode} setAuthMode={setAuthMode}
                authEmail={authEmail} setAuthEmail={setAuthEmail}
                authPassword={authPassword} setAuthPassword={setAuthPassword}
                authDisplayName={authDisplayName} setAuthDisplayName={setAuthDisplayName}
                authError={authError} onEmailSignIn={handleEmailSignIn} onEmailSignUp={handleEmailSignUp} />

          {FIREBASE_READY && !user && !authLoading && !authMode && activeList.length > 0 && (
            <div className="signin-prompt">
              <p>Sign in to save your rankings to the cloud and share them with friends.</p>
              <button className="auth-btn auth-btn-signin" onClick={handleSignIn}>
                Sign in with Google
              </button>
              <div className="auth-divider" style={{margin:"8px 0"}}>or</div>
              <button className="auth-btn auth-btn-email" onClick={() => setAuthMode("signin")}>
                Sign in with Email
              </button>
            </div>
          )}

          <div className="nav-tabs">
            <button className={`nav-tab ${tab === "rank" ? "active" : ""}`} onClick={() => setTab("rank")}>
              My Rankings
            </button>
            <button className={`nav-tab ${tab === "watchlist" ? "active" : ""}`} onClick={() => setTab("watchlist")}>
              Watchlist {activeWatchlist.length > 0 ? `(${activeWatchlist.length})` : ""}
            </button>
            {FIREBASE_READY && (
              <button className={`nav-tab ${tab === "community" ? "active" : ""}`} onClick={() => setTab("community")}>
                Community
              </button>
            )}
          </div>

          {tab === "rank" && (
            <>
              <SearchBar onSelect={handleSelectMovie} onBookmark={handleAddToWatchlist}
                onRerank={handleRerank}
                rankedIds={activeIds} watchlistIds={activeWatchlistIds}
                localDb={isTV ? TV_DB : MOVIE_DB}
                searchFn={isTV ? searchTMDBTV : searchTMDB}
                placeholder={isTV ? "Search for a TV show to rank..." : "Search for a movie to rank..."}
                customLabel={isTV ? "TV show" : "movie"} />
              <Recommendations onSelect={handleSelectMovie} onBookmark={handleAddToWatchlist}
                rankedIds={activeIds} watchlistIds={activeWatchlistIds} rankedList={activeList}
                localDb={isTV ? TV_DB : MOVIE_DB} mode={mode} />
              <RankedList list={activeList} onRemove={handleRemove} onClear={handleClear}
                onMove={handleMove} onShare={handleShare} user={user}
                onShareCard={(m) => openShareCardFor(m, isTV)}
                onMovieClick={setDetailMovie}
                isPrivate={isPrivate} onTogglePrivate={handleTogglePrivate}
                onImport={!isTV ? () => setShowImport(true) : undefined}
                onUndoImport={!isTV ? undoLastImport : undefined}
                itemLabel={isTV ? "TV show" : "movie"} />
              {activeList.length > 0 && (
                <div className={`stats-accordion ${statsOpen ? "open" : ""}`}>
                  <div className="stats-accordion-header" onClick={() => setStatsOpen(o => !o)}>
                    <h3>📊 Stats & Insights</h3>
                    <span className="stats-chevron">▼</span>
                  </div>
                  <div className="stats-body">
                    <StatsView rankedList={activeList} watchlist={activeWatchlist} isTV={isTV} />
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "watchlist" && (
            <div className="watchlist-section">
              <SearchBar onSelect={handleAddToWatchlist} rankedIds={activeWatchlistIds}
                localDb={isTV ? TV_DB : MOVIE_DB}
                searchFn={isTV ? searchTMDBTV : searchTMDB}
                placeholder={isTV ? "Search for a TV show to add to watchlist..." : "Search for a movie to add to watchlist..."}
                customLabel={isTV ? "TV show" : "movie"}
                dupeLabel="Already on watchlist" />
              {activeWatchlist.length === 0 ? (
                <div className="watchlist-empty">
                  <p>&#x1F4D6;</p>
                  <p>No {isTV ? "TV shows" : "movies"} on your watchlist yet.</p>
                  <p style={{fontSize:"0.85rem",marginTop:8}}>Search above to add some!</p>
                </div>
              ) : (
                <>
                  <h2 style={{marginBottom:16}}>Watchlist ({activeWatchlist.length})</h2>
                  <div className="watchlist-list">
                    {activeWatchlist.map(movie => (
                      <div key={movie.id} className="watchlist-item">
                        <Poster poster={movie.poster} title={movie.title}
                          className={movie.poster ? "ranked-poster" : "ranked-poster-ph poster-placeholder"} />
                        <div className="ranked-item-info">
                          <div className="ranked-item-title">{movie.title}</div>
                          <div className="ranked-item-year">{movie.year}{movie.genre ? ` \u00b7 ${movie.genre}` : ""}</div>
                        </div>
                        <button className="watchlist-watched-btn" onClick={() => handleWatchedIt(movie)}
                          title="Watched it — rank it now!">
                          &#x2714; Watched
                        </button>
                        <button className="watchlist-remove-btn" onClick={() => handleRemoveFromWatchlist(movie.id)}
                          title="Remove from watchlist">&#x2715;</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "community" && (
            <CommunityView onViewProfile={handleViewProfile} currentUid={user ? user.uid : null}
              currentDisplayName={user ? user.displayName : null}
              currentPhotoURL={user ? user.photoURL : null}
              isAdmin={user && user.uid === ADMIN_UID}
              myMovies={rankedList} myTv={tvRankedList}
              onMovieClick={handleActivityMovieClick} />
          )}

          <ComparisonView session={activeSession} onChoice={handleChoice} onCancel={handleCancelSession}
            onWatchlist={handleAddToWatchlistFromComparison}
            onSkip={handleCantDecide}
            itemLabel={isTV ? "TV show" : "movie"} />
          <MovieDetail movie={detailMovie} onClose={() => setDetailMovie(null)}
            onRerank={handleRerank} onRemove={handleRemove} rankedList={activeList} isTV={isTV}
            onShareCard={openShareCardFor} />
          <ShareCard item={shareCard} user={user} isPrivate={isPrivate}
            onClose={() => setShareCard(null)} onToast={showToast}
            onMakePublic={isPrivate ? handleTogglePrivate : null} />
          {showImport && (
            <LetterboxdImport
              onImport={handleLetterboxdImport}
              onClose={() => setShowImport(false)}
              existingCount={rankedList.length} />
          )}
          <Toast message={toast}
            actionLabel={justRanked ? "Share \u2197" : null}
            onAction={() => setShareCard(justRanked)} />
          <footer style={{textAlign:"center",padding:"40px 0 20px",opacity:0.5}}>
            <div style={{color:"var(--text-muted)",fontSize:"12px",marginBottom:"8px"}}>a website by Axel Hufford &middot; <a href="https://axelhufford.com" target="_blank" rel="noopener noreferrer" style={{color:"var(--text-muted)"}}>axelhufford.com</a></div>
            <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:"8px",color:"var(--text-muted)",textDecoration:"none",fontSize:"12px"}}>
              <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg" alt="TMDB" style={{height:"16px"}} />
              Data provided by TMDB
            </a>
          </footer>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<App />);
