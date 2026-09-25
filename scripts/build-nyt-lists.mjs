// Builds nyt-lists.js: The New York Times' "100 Best TV Shows of the 21st
// Century" and "100 Best Movies of the 21st Century" (June 2025), matched to
// TMDB ids so they line up with the ids in everyone's rankings/watchlists.
//
//   node scripts/build-nyt-lists.mjs
//
// Every match is printed; "CHECK" marks ones whose title or year differ from
// the NYT entry. Pin a bad match in OVERRIDES by TMDB id and re-run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "firebase-config.js"), "utf8");
const API_KEY = (config.match(/TMDB_API_KEY_CONFIG\s*=\s*"([^"]+)"/) || [])[1];
if (!API_KEY) throw new Error("TMDB_API_KEY_CONFIG not found in firebase-config.js");

// Same maps as src/app.jsx
const GENRE_MAP = {28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Sci-Fi",10770:"TV Movie",53:"Thriller",10752:"War",37:"Western"};
const TV_GENRE_MAP = {10759:"Action & Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",10762:"Kids",9648:"Mystery",10763:"News",10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",37:"Western"};

// [nytRank, title as NYT prints it, first year, optional TMDB search query]
const TV = [
  [1, "Breaking Bad", 2008], [2, "The Wire", 2002], [3, "Mad Men", 2007], [4, "Succession", 2018],
  [5, "Fleabag", 2016], [6, "Game of Thrones", 2011], [7, "Veep", 2012], [8, "30 Rock", 2006],
  [9, "Curb Your Enthusiasm", 2000], [10, "Atlanta", 2016], [11, "The Office (U.S.)", 2005, "The Office"],
  [12, "Arrested Development", 2003], [13, "Girls", 2012], [14, "Friday Night Lights", 2006],
  [15, "Six Feet Under", 2001], [16, "The Office (U.K.)", 2001, "The Office"], [17, "The Americans", 2013],
  [18, "I May Destroy You", 2020], [19, "Chernobyl", 2019], [20, "The Crown", 2016],
  [21, "The White Lotus", 2021], [22, "Lost", 2004], [23, "The Comeback", 2005], [24, "Deadwood", 2004],
  [25, "The Leftovers", 2014], [26, "Black Mirror", 2011], [27, "Better Call Saul", 2015],
  [28, "Band of Brothers", 2001], [29, "Key & Peele", 2012], [30, "Severance", 2022], [31, "Survivor", 2000],
  [32, "Andor", 2022], [33, "Enlightened", 2011], [34, "Schitt's Creek", 2015],
  [35, "True Detective (Season 1)", 2014, "True Detective"], [36, "The Pitt", 2025],
  [37, "Battlestar Galactica", 2005], [38, "Homeland", 2011], [39, "Watchmen", 2019], [40, "Adolescence", 2025],
  [41, "Louie", 2010], [42, "Hacks", 2021], [43, "Peaky Blinders", 2013], [44, "BoJack Horseman", 2014],
  [45, "Happy Valley", 2014], [46, "Broad City", 2014], [47, "Twin Peaks: The Return", 2017],
  [48, "House of Cards", 2013], [49, "Normal People", 2020], [50, "Parks and Recreation", 2009],
  [51, "The Good Place", 2016], [52, "Downton Abbey", 2010], [53, "Stranger Things", 2016],
  [54, "The Bureau", 2015], [55, "Insecure", 2016], [56, "Nathan for You", 2013],
  [57, "I Think You Should Leave", 2019, "I Think You Should Leave with Tim Robinson"],
  [58, "Chappelle's Show", 2003], [59, "PEN15", 2019], [60, "Peep Show", 2003],
  [61, "RuPaul's Drag Race", 2009], [62, "Slow Horses", 2022], [63, "The Thick of It", 2005],
  [64, "Anthony Bourdain: Parts Unknown", 2013], [65, "Mare of Easttown", 2021], [66, "The Rehearsal", 2022],
  [67, "The Handmaid's Tale", 2017], [68, "Ozark", 2017], [69, "Anthony Bourdain: No Reservations", 2005],
  [70, "The Shield", 2002], [71, "Beef (Season 1)", 2023, "Beef"], [72, "Squid Game", 2021], [73, "Barry", 2018],
  [74, "The Bear", 2022], [75, "Ted Lasso", 2020], [76, "Somebody Somewhere", 2022], [77, "Modern Family", 2009],
  [78, "It's Always Sunny in Philadelphia", 2005], [79, "The Good Wife", 2009],
  [80, "How To With John Wilson", 2020], [81, "The Queen's Gambit", 2020], [82, "Better Things", 2016],
  [83, "Justified", 2010], [84, "Planet Earth", 2006], [85, "The Great British Baking Show", 2010, "The Great British Bake Off"],
  [86, "Shogun", 2024], [87, "Reservation Dogs", 2021], [88, "Dexter", 2006], [89, "Baby Reindeer", 2024],
  [90, "Eastbound & Down", 2009], [91, "Catastrophe", 2015], [92, "The Night Of", 2016],
  [93, "Station Eleven", 2021], [94, "The Diplomat", 2023], [95, "House", 2004], [96, "Halt and Catch Fire", 2014],
  [97, "Community", 2009], [98, "The OA", 2016], [99, "Gilmore Girls", 2000], [100, "Scandal", 2012],
];

const MOVIES = [
  [1, "Parasite", 2019], [2, "Mulholland Drive", 2001], [3, "There Will Be Blood", 2007],
  [4, "In the Mood for Love", 2000], [5, "Moonlight", 2016], [6, "No Country for Old Men", 2007],
  [7, "Eternal Sunshine of the Spotless Mind", 2004], [8, "Get Out", 2017], [9, "Spirited Away", 2001],
  [10, "The Social Network", 2010], [11, "Mad Max: Fury Road", 2015], [12, "The Zone of Interest", 2023],
  [13, "Children of Men", 2006], [14, "Inglourious Basterds", 2009], [15, "City of God", 2002],
  [16, "Crouching Tiger, Hidden Dragon", 2000], [17, "Brokeback Mountain", 2005], [18, "Y tu mamá también", 2001],
  [19, "Zodiac", 2007], [20, "The Wolf of Wall Street", 2013], [21, "The Royal Tenenbaums", 2001],
  [22, "The Grand Budapest Hotel", 2014], [23, "Boyhood", 2014], [24, "Her", 2013], [25, "Phantom Thread", 2017],
  [26, "Anatomy of a Fall", 2023], [27, "Adaptation", 2002], [28, "The Dark Knight", 2008], [29, "Arrival", 2016],
  [30, "Lost in Translation", 2003], [31, "The Departed", 2006], [32, "Bridesmaids", 2011],
  [33, "A Separation", 2011], [34, "WALL·E", 2008], [35, "A Prophet", 2009], [36, "A Serious Man", 2009],
  [37, "Call Me by Your Name", 2017], [38, "Portrait of a Lady on Fire", 2019], [39, "Lady Bird", 2017],
  [40, "Yi Yi", 2000], [41, "Amélie", 2001], [42, "The Master", 2012], [43, "Oldboy", 2003],
  [44, "Once Upon a Time… in Hollywood", 2019, "Once Upon a Time in Hollywood"], [45, "Moneyball", 2011],
  [46, "Roma", 2018], [47, "Almost Famous", 2000], [48, "The Lives of Others", 2006], [49, "Before Sunset", 2004],
  [50, "Up", 2009], [51, "12 Years a Slave", 2013], [52, "The Favourite", 2018], [53, "Borat", 2006],
  [54, "Pan's Labyrinth", 2006], [55, "Inception", 2010], [56, "Punch-Drunk Love", 2002], [57, "Best in Show", 2000],
  [58, "Uncut Gems", 2019], [59, "Toni Erdmann", 2016], [60, "Whiplash", 2014], [61, "Kill Bill: Vol. 1", 2003],
  [62, "Memento", 2000], [63, "Little Miss Sunshine", 2006], [64, "Gone Girl", 2014], [65, "Oppenheimer", 2023],
  [66, "Spotlight", 2015], [67, "Tár", 2022], [68, "The Hurt Locker", 2008], [69, "Under the Skin", 2013],
  [70, "Let the Right One In", 2008], [71, "Ocean's Eleven", 2001], [72, "Carol", 2015], [73, "Ratatouille", 2007],
  [74, "The Florida Project", 2017], [75, "Amour", 2012], [76, "O Brother, Where Art Thou?", 2000],
  [77, "Everything Everywhere All at Once", 2022], [78, "Aftersun", 2022], [79, "The Tree of Life", 2011],
  [80, "Volver", 2006], [81, "Black Swan", 2010], [82, "The Act of Killing", 2012], [83, "Inside Llewyn Davis", 2013],
  [84, "Melancholia", 2011], [85, "Anchorman: The Legend of Ron Burgundy", 2004], [86, "Past Lives", 2023],
  [87, "The Lord of the Rings: The Fellowship of the Ring", 2001], [88, "The Gleaners and I", 2000],
  [89, "Interstellar", 2014], [90, "Frances Ha", 2012], [91, "Fish Tank", 2009], [92, "Gladiator", 2000],
  [93, "Michael Clayton", 2007], [94, "Minority Report", 2002], [95, "The Worst Person in the World", 2021],
  [96, "Black Panther", 2018], [97, "Gravity", 2013], [98, "Grizzly Man", 2005], [99, "Memories of Murder", 2003],
  [100, "Superbad", 2007],
];

// Pinned TMDB ids for entries search can't resolve on its own.
const OVERRIDES = {
  tv: {
    47: 1920, // Twin Peaks: The Return is season 3 of Twin Peaks on TMDB
  },
  movie: {
    69: 97370, // Under the Skin (Glazer); a 2013 Brazilian film of the same name outranks it on year
  },
};

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\(.*?\)/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

async function tmdb(path, params = {}) {
  const url = new URL("https://api.themoviedb.org/3" + path);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} for ${path}`);
  return resp.json();
}

function pick(results, title, year, isTV) {
  const want = norm(title);
  const yearOf = r => parseInt((isTV ? r.first_air_date : r.release_date) || "0", 10);
  const nameOf = r => (isTV ? r.name : r.title) || "";
  const score = r => {
    let s = 0;
    const n = norm(nameOf(r));
    const o = norm((isTV ? r.original_name : r.original_title) || "");
    if (n === want || o === want) s += 100;
    else if (n.startsWith(want) || want.startsWith(n)) s += 30;
    const dy = Math.abs(yearOf(r) - year);
    s += dy === 0 ? 40 : dy === 1 ? 25 : dy <= 3 ? 5 : -20;
    s += Math.min(20, Math.log10((r.vote_count || 0) + 1) * 6);
    return s;
  };
  return [...results].sort((a, b) => score(b) - score(a))[0];
}

async function resolve(entry, isTV) {
  const [rank, title, year, query] = entry;
  const kind = isTV ? "tv" : "movie";
  const pinned = OVERRIDES[kind][rank];
  let r;
  if (pinned) {
    r = await tmdb(`/${kind}/${pinned}`);
    r.genre_ids = (r.genres || []).map(g => g.id);
  } else {
    const q = query || title.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const yearParam = isTV ? { first_air_date_year: year } : { year };
    let res = (await tmdb(`/search/${kind}`, { query: q, include_adult: "false", ...yearParam })).results;
    // Year filters are strict; retry wider when the NYT year is off by one
    if (!res.length || !res.some(x => norm((isTV ? x.name : x.title) || "") === norm(q))) {
      const wide = (await tmdb(`/search/${kind}`, { query: q, include_adult: "false" })).results;
      res = res.concat(wide);
    }
    if (!res.length) throw new Error(`No TMDB match for #${rank} ${title}`);
    r = pick(res, q, year, isTV);
  }
  const name = isTV ? r.name : r.title;
  const gotYear = parseInt((isTV ? r.first_air_date : r.release_date) || "0", 10);
  const map = isTV ? TV_GENRE_MAP : GENRE_MAP;
  const genre = (r.genre_ids && r.genre_ids.length && map[r.genre_ids[0]]) || "Drama";
  const wantName = norm(query || title);
  const flag = (pinned ? "" : (norm(name) !== wantName ? " CHECK-title" : "")) +
    (Math.abs(gotYear - year) > 1 && !pinned ? " CHECK-year" : "") + (r.poster_path ? "" : " NO-POSTER") +
    ((r.vote_count || 0) < 150 && !pinned ? ` CHECK-votes(${r.vote_count || 0})` : "");
  console.log(`${kind} #${String(rank).padStart(3)} ${title} (${year}) -> ${r.id} ${name} (${gotYear}) ${genre}${flag}`);
  // Keep the NYT's title and year so the list reads the way the printout does
  return [rank, r.id, title, year, genre, r.poster_path || null];
}

async function build(list, isTV) {
  const out = [];
  for (const entry of list) out.push(await resolve(entry, isTV));
  const ids = new Set(out.map(e => e[1]));
  const ranks = out.map(e => e[0]).join(",");
  const expected = Array.from({ length: 100 }, (_, i) => i + 1).join(",");
  if (out.length !== 100 || ranks !== expected) throw new Error(`${isTV ? "TV" : "Movie"} list is not ranks 1-100`);
  if (ids.size !== 100) throw new Error(`${isTV ? "TV" : "Movie"} list has duplicate TMDB ids`);
  return out;
}

const tv = await build(TV, true);
const movies = await build(MOVIES, false);
const fmt = rows => rows.map(r => "  " + JSON.stringify(r)).join(",\n");
const file = `// The New York Times' "The 100 Best TV Shows of the 21st Century" and
// "The 100 Best Movies of the 21st Century" (June 2025), matched to TMDB.
// Generated by scripts/build-nyt-lists.mjs; edit that file, not this one.
// Format: [nytRank, tmdb_id, "Title", year, "Genre", "/poster_path.jpg"]
const NYT_TV_100 = [
${fmt(tv)}
];
const NYT_MOVIES_100 = [
${fmt(movies)}
];
`;
writeFileSync(join(root, "nyt-lists.js"), file);
console.log("\nWrote nyt-lists.js");
