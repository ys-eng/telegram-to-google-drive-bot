const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

// רשימת כל 23 המשתמשים
const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes',
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker',
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz',
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus',
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

const TWEETS_PER_USER = 15;
const TARGET_ITEMS = twitterUsernames.length * TWEETS_PER_USER; // 345 פריטים

(async () => {
  console.log(`Starting Stable Apify Twitter Scraper (altimis/scweet) for ${twitterUsernames.length} users...`);
  console.log(`Target items to collect: ${TARGET_ITEMS}`);

  const input = {
    "source_mode": "search",
    "from_users": twitterUsernames,
    "max_items": Math.max(100, TARGET_ITEMS),
    "search_sort": "Latest"
  };

  const actorName = "altimis~scweet";
  let runId = null;

  try {
    console.log(`Calling Apify Actor (${actorName.replace('~', '/')})...`);

    // 1. הפעלת הריצה ב-Apify
    const runResponse = await fetch(`https://api.apify.com/v2/acts/${actorName}/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      throw new Error(`Failed to start Apify run: ${runResponse.status} - ${errorText}`);
    }

    const runData = await runResponse.json();
    runId = runData.data.id;
    const defaultDatasetId = runData.data.defaultDatasetId;
    console.log(`Run started successfully! Run ID: ${runId}`);
    console.log(`You can monitor it live here: https://console.apify.com/actors/runs/${runId}`);

    // 2. המתנה עם מנגנון הגנה וחילוץ מוקדם
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 25 * 60 * 1000; 
    
    let lastItemCount = 0;
    let noProgressCycles = 0;
    let earlyExit = false;

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error(`Timeout reached while waiting for Apify to finish. Check directly at: https://console.apify.com/actors/runs/${runId}`);
      }

      let itemCount = null;
      try {
        const datasetInfoResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}?token=${APIFY_TOKEN}`);
        if (datasetInfoResponse.ok) {
          const datasetInfo = await datasetInfoResponse.json();
          itemCount = datasetInfo.data.itemCount;
        }
      } catch (e) {
        // שגיאה לא קריטית בתשאול ה-dataset
      }

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Items collected so far: ${itemCount !== null ? itemCount : 'unknown'}.`);

      if (itemCount !== null) {
        // בדיקה 1: האם הגענו ליעד המספרי של הציוצים?
        if (itemCount >= TARGET_ITEMS) {
          console.log(`\n[✓] Target reached (${itemCount}/${TARGET_ITEMS}). Exiting loop early to process data!`);
          earlyExit = true;
          break;
        }

        // בדיקה 2: האם הנתונים תקועים על מספר גבוה (מעל 100) ולא זזים במשך 3 דקות רצופות?
        if (itemCount > 100 && itemCount === lastItemCount) {
          noProgressCycles++;
          // 9 מחזורים של 20 שניות = 3 דקות
          if (noProgressCycles >= 9) {
            console.log(`\n[!] Progress stuck at ${itemCount} items for 3 minutes. Exiting early to save collected data!`);
            earlyExit = true;
            break;
          }
        } else {
          noProgressCycles = 0;
        }
        
        lastItemCount = itemCount;
      }

      console.log(`Waiting 20 seconds for next check...`);
      await new Promise(resolve => setTimeout(resolve, 20000));

      const statusResponse = await fetch(`https://api.apify.com/v2/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
      }
    }

    console.log(`Apify run loop exited. Final status check: ${status}`);

    // אם לא יצאנו מוקדם באופן יזום, נוודא שהריצה באמת הצליחה
    if (!earlyExit && status !== 'SUCCEEDED') {
      console.log(`\n[!] Run failed with status: ${status}. Fetching internal Apify logs...`);
      try {
        const logResponse = await fetch(`https://api.apify.com/v2/run-logs/${runId}?token=${APIFY_TOKEN}`);
        const logText = await logResponse.text();
        console.log("\n=================== APIFY INTERNAL LOGS ===================");
        if (logText) {
          console.log(logText.split('\n').slice(-40).join('\n'));
        } else {
          console.log("No logs returned from Apify.");
        }
        console.log("===========================================================\n");
      } catch (logErr) {
        console.error("Could not fetch Apify run logs:", logErr.message);
      }

      throw new Error(`Apify run finished with non-success status: ${status}.`);
    }

    // 3. שליפת המידע מה-Dataset
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);

    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. עיבוד וסינון המידע
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        const text = item.text || '';
        if (!text) return null;

        const rawUsername = item.handle || item.username || 'unknown';
        const username = String(rawUsername).replace('@', '');
        
        const createdAt = item.created_at || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        let media = [];
        if (item.tweet && Array.isArray(item.tweet.media)) {
          media = item.tweet.media;
        }

        return {
          id: item.id || String(timestamp),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          tweet_url: item.tweet_url || null,
          media: [...new Set(media.filter(Boolean))]
        };
      })
      .filter(item => item !== null);

    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // 5. שמירה ומיזוג חכם עם קובץ קיים
    let existingTweets = [];
    if (fs.existsSync('tweets.json')) {
      try {
        existingTweets = JSON.parse(fs.readFileSync('tweets.json', 'utf8'));
      } catch (e) {
        existingTweets = [];
      }
    }

    const allTweetsMap = new Map();
    existingTweets.forEach(t => allTweetsMap.set(t.id, t));
    formattedTweets.forEach(t => allTweetsMap.set(t.id, t));

    const mergedTweets = Array.from(allTweetsMap.values());
    mergedTweets.sort((a, b) => b.timestamp - a.timestamp);

    const finalTweets = mergedTweets.slice(0, 150);

    fs.writeFileSync('tweets.json', JSON.stringify(finalTweets, null, 2));
    console.log(`\nFinished! Successfully processed tweets. Total tweets in database: ${finalTweets.length}`);

    // (אופציונלי אך מומלץ): כיבוי יזום של הריצה ב-Apify כדי לא לבזבז Compute units בחינם
    if (earlyExit && (status === 'RUNNING' || status === 'READY')) {
      console.log("Sending abort signal to Apify to save your platform usage limits...");
      await fetch(`https://api.apify.com/v2/runs/${runId}/abort?token=${APIFY_TOKEN}`, { method: 'POST' }).catch(() => {});
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1);
  }
})();
