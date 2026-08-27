/**
 * One-off cleanup: remove phantom "ranked" activity events.
 *
 * Background
 * ----------
 * Until commit ec450db, handleRerank committed the removal of a title to state
 * before the comparison session began. The debounced profile save persisted
 * that shorter list, so the later re-insert looked like a brand new ranking to
 * saveProfile's `newMovieCount > oldMovieCount` check and wrote a duplicate
 * "ranked" event — even when the user cancelled and nothing actually moved.
 *
 * How to run
 * ----------
 * Open https://movirank.com signed in as the owning account, then paste this
 * whole file into the DevTools console. It prints a dry-run plan first; set
 * APPLY = true and re-run to actually delete.
 *
 * Scope
 * -----
 * ONLY deletes events identical in uid + title + isTV + RANK, keeping the
 * oldest of each group. Two events saying "ranked X at #87" carry the same
 * information no matter how far apart they are, so the later ones are noise.
 * Note there is deliberately no time window: the phantoms this was written for
 * landed two days after the genuine event, so any recency guard would miss them.
 *
 * Deliberately NOT deleted: same-title events with DIFFERENT ranks. Those are
 * real re-ranks that moved the title, and the feed entry was true when written.
 */
var APPLY = false;              // flip to true to perform the deletion
var ONLY_UID = null;            // set to a uid string to restrict to one account

(async function () {
  var db = firebase.firestore();
  var snap = await db.collection("activity").get();

  var groups = {};
  snap.docs.forEach(function (d) {
    var v = d.data();
    if (v.type !== "ranked" || !v.movie) return;
    if (ONLY_UID && v.uid !== ONLY_UID) return;
    // Rank is part of the key: a rank change is legitimate history, not a dupe.
    var key = v.uid + "|" + v.movie.id + "|" + (v.isTV ? "tv" : "mv") + "|" + v.rank;
    (groups[key] = groups[key] || []).push({
      id: d.id,
      title: v.movie.title,
      rank: v.rank,
      ms: v.timestamp ? v.timestamp.toDate().getTime() : 0,
    });
  });

  var doomed = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k].sort(function (a, b) { return a.ms - b.ms; });
    if (g.length < 2) return;
    // Oldest wins: it is the genuine ranking.
    g.slice(1).forEach(function (e) { doomed.push(e); });
  });

  if (!doomed.length) { console.log("Nothing to delete."); return; }

  console.log((APPLY ? "DELETING " : "DRY RUN — would delete ") + doomed.length + " event(s):");
  doomed.forEach(function (e) {
    console.log("  " + e.id + "  " + e.title + " @ #" + e.rank + "  " + new Date(e.ms).toISOString());
  });
  if (!APPLY) { console.log("\nSet APPLY = true and re-run to apply."); return; }

  var batch = db.batch();
  doomed.forEach(function (e) { batch.delete(db.collection("activity").doc(e.id)); });
  await batch.commit();
  console.log("Deleted " + doomed.length + " event(s).");
})();
