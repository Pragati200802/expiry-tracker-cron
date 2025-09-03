/**
 * Daily expiry alerts via Firebase Admin SDK (v11+)
 * - Reads Firestore "products" with status ACTIVE and expiryDate <= cutoff
 * - Sends a multicast push to all saved device tokens under users/{uid}/tokens/{token}
 * - Designed for GitHub Actions (service account JSON passed in FIREBASE_KEY)
 */

const admin = require("firebase-admin");

// ---- 0) Read credentials from GitHub Secret ----
if (!process.env.FIREBASE_KEY) {
  console.error("FIREBASE_KEY secret is missing.");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

// ---- 1) Init Admin SDK ----
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const messaging = admin.messaging();

// ---- 2) Small helpers ----
function todayISO() {
  const d = new Date();
  // Use local date; store as YYYY-MM-DD to match app schema
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + days);
  const y2 = base.getFullYear();
  const m2 = String(base.getMonth() + 1).padStart(2, "0");
  const d2 = String(base.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getExpiringSoonCount(daysAhead = 3) {
  const today = todayISO();
  const cutoff = addDaysISO(today, daysAhead);

  // Query products expiring soon, ACTIVE only
  const snap = await db
    .collection("products")
    .where("status", "==", "ACTIVE")
    .where("expiryDate", "<=", cutoff) // expiryDate is stored as "YYYY-MM-DD"
    .get();

  return snap.size;
}

async function getAllTokens() {
  // users/{uid}/tokens/{tokenDocId}
  const snap = await db.collectionGroup("tokens").get();
  // Doc ID is the token; or it may be in a field (support both)
  return snap.docs
    .map((d) => d.id || d.get("token"))
    .filter((t) => typeof t === "string" && t.length > 0);
}

async function sendMulticast(tokens, title, body) {
  if (!tokens.length) {
    console.log("No tokens registered.");
    return { successCount: 0, failureCount: 0 };
  }

  // FCM allows up to 500 tokens per request
  const batches = chunk(tokens, 500);
  let success = 0;
  let failure = 0;

  for (const batch of batches) {
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
    });
    success += res.successCount;
    failure += res.failureCount;
  }
  return { successCount: success, failureCount: failure };
}

async function main() {
  console.log("Checking for expiring products...");

  // Choose the window you want to alert on (3 days is a sensible demo)
  const daysAhead = 3;
  const count = await getExpiringSoonCount(daysAhead);

  if (count === 0) {
    console.log("No products expiring soon.");
    return;
  }

  const tokens = await getAllTokens();
  const title = "Expiry Alert";
  const body = `You have ${count} product(s) expiring within ${daysAhead} day(s).`;

  const result = await sendMulticast(tokens, title, body);
  console.log(
    `Alerts sent! Success: ${result.successCount}, Failure: ${result.failureCount}`
  );
}

main().catch((err) => {
  console.error("Job failed:", err);
  process.exit(1);
});
