const admin = require("firebase-admin");

// Parse key from secret
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

// Init app
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

async function main() {
  console.log("Checking for expiring products...");

  // Example: fetch products expiring within 3 days
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() + 3);

  const snap = await db.collection("products")
    .where("expiryDate", "<=", cutoff.toISOString().split("T")[0])
    .get();

  if (snap.empty) {
    console.log("No products expiring soon.");
    return;
  }

  const tokensSnap = await db.collectionGroup("tokens").get();
  const tokens = tokensSnap.docs.map(d => d.id);

  if (tokens.length === 0) {
    console.log("No tokens registered.");
    return;
  }

  const payload = {
    notification: {
      title: "Expiry Alert",
      body: `You have ${snap.size} product(s) expiring soon.`
    }
  };

  await messaging.sendToDevice(tokens, payload);
  console.log("Alerts sent!");
}

main().catch(console.error);
