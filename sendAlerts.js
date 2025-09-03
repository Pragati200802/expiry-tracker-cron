const admin = require("firebase-admin");

/** ---- Init ---- **/
if (!process.env.FIREBASE_KEY) { console.error("FIREBASE_KEY secret is missing."); process.exit(1); }
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const messaging = admin.messaging();

/** ---- Date helpers ---- **/
function todayAtMidnight() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}
function isoAddDays(base, days) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`; // matches your schema "YYYY-MM-DD"
}
function daysUntil(expiryStr, today) {
  if (!expiryStr) return Infinity;
  const [y,m,d] = String(expiryStr).split("-").map(Number);
  const exp = new Date(y, (m||1)-1, d||1);
  exp.setHours(0,0,0,0);
  return Math.floor((exp - today)/86400000); // 0=today, 1=tomorrow, negatives=expired
}

/** ---- Firestore helpers ---- **/
async function getActiveExpiringWithin7Days() {
  const today = todayAtMidnight();
  const cutoff7 = isoAddDays(today, 7);

  // Composite index needed: products(status asc, expiryDate asc)
  const snap = await db.collection("products")
    .where("status","==","ACTIVE")
    .where("expiryDate","<=", cutoff7)
    .get();

  const items = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (!d || !d.expiryDate) return;
    items.push(d);
  });
  return items;
}

async function getAllTokensWithRefs(){
  const snap = await db.collectionGroup("tokens").get();
  return snap.docs.map(d => {
    const token = d.id || d.get("token");
    return token ? { token, ref: d.ref } : null;
  }).filter(Boolean);
}

/** ---- Send + clean ---- **/
function chunk(a,n){ const out=[]; for(let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; }

async function sendMulticastAndClean(tokenObjs, title, body){
  if (!tokenObjs.length){ console.log("No tokens registered."); return { successCount:0, failureCount:0 }; }

  const batches = chunk(tokenObjs, 500);
  let success=0, failure=0;
  const toDelete = [];

  for (const batch of batches){
    const tokens = batch.map(t => t.token);
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: "https://expiry-tracker-1c3a3.web.app" } }
    });

    res.responses.forEach((r,i)=>{
      if (r.success){ success++; return; }
      failure++;
      const code = r.error?.code || r.error?.message || "unknown";
      const short = tokens[i]?.slice(0,20) + "…";
      console.log(`Token failed: ${short} → ${code}`);
      if (/not-registered|invalid-argument/i.test(String(code))) toDelete.push(batch[i].ref);
    });
  }

  for (const ref of toDelete){
    try { await ref.delete(); console.log(`Deleted invalid token doc: ${ref.path}`); }
    catch(e){ console.log(`Failed to delete ${ref.path}: ${e.message}`); }
  }

  return { successCount:success, failureCount:failure };
}

/** ---- Main: one notification with 7/3/1 buckets ---- **/
async function main(){
  console.log("Checking for expiring products (≤7d, bucketed)…");
  const today = todayAtMidnight();

  // Get up to 7 days and bucket exclusively: ≤1d, 2–3d, 4–7d
  const items = await getActiveExpiringWithin7Days();

  let c1 = 0;   // ≤1 day (includes already expired)
  let c3 = 0;   // 2–3 days
  let c7 = 0;   // 4–7 days

  for (const it of items){
    const dd = daysUntil(it.expiryDate, today);
    if (dd <= 1) c1++;
    else if (dd <= 3) c3++;
    else if (dd <= 7) c7++;
  }

  const total = c1 + c3 + c7;
  if (total === 0) {
    console.log("No products expiring within 7 days.");
    return;
  }

  const title = "Expiry Summary (7/3/1)";
  // e.g., "≤1d=1 • 2–3d=2 • 4–7d=3 (total 6)"
  const body  = `\u22641d=${c1} • 2–3d=${c3} • 4–7d=${c7} (total ${total})`;

  const tokenObjs = await getAllTokensWithRefs();
  const result = await sendMulticastAndClean(tokenObjs, title, body);
  console.log(`Alerts sent! Success: ${result.successCount}, Failure: ${result.failureCount}`);
}

main().catch(err => { console.error("Job failed:", err); process.exit(1); });
