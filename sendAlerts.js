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

  // NEW: always log buckets + token count for your screenshot
  const tokenObjs = await getAllTokensWithRefs();
  console.log(`Buckets: <=1d=${c1}, 2–3d=${c3}, 4–7d=${c7} (total ${total})`);
  console.log(`Tokens found: ${tokenObjs.length}`);

  if (total === 0) {
    console.log("No products expiring within 7 days. Skipping send.");
    return;
  }
  if (tokenObjs.length === 0) {
    console.log("No device tokens registered. Skipping send.");
    return;
  }

  const title = "Expiry Summary (7/3/1)";
  const body  = `\u22641d=${c1} • 2–3d=${c3} • 4–7d=${c7} (total ${total})`;

  const result = await sendMulticastAndClean(tokenObjs, title, body);
  console.log(`Alerts sent! Success: ${result.successCount}, Failure: ${result.failureCount}`);
}

main().catch(err => {
  console.error("Job failed:", err);
  process.exit(1);
});
