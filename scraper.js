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

(async () => {
  console.log(`Starting OFFICIAL Apify Twitter Scraper (apify/twitter-scraper) for ${twitterUsernames.length} users...`);

  // הגדרת הקלט הרשמי והעדכני של Apify Twitter Scraper
  const input = {
    "twitterHandles": twitterUsernames,
    "maxTweets": TWEETS_PER_USER,
    "handleProfiles": false, // מעניין אותנו רק הציוצים, לא הפרופיל
    "scrapeTweetDetails": true
  };

  const actorName = "apify~twitter-scraper";
  let runId = null;

  try {
    console.log(`Calling Official Apify Actor (${actorName.replace('~', '/')})...`);

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
    console.log(`Monitor live here: https://console.apify.com/actors/runs/${runId}`);

    // 2. המתנה לריצה עם מעקב התקדמות וחילוץ מוקדם
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 20 * 60 * 1000; // 20 דקות
    
    let lastItemCount = 0;
    let noProgressCycles = 0;
    let earlyExit = false;

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error(`Timeout reached. Check run status directly at: https://console.apify.com/actors/runs/${runId}`);
      }

      let itemCount = null;
      try {
        const datasetInfoResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}?token=${APIFY_TOKEN}`);
        if (datasetInfoResponse.ok) {
          const datasetInfo = await datasetInfoResponse.json();
          itemCount = datasetInfo.data.itemCount;
        }
      } catch (e) {}

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Items collected so far: ${itemCount !== null ? itemCount : 'unknown'}.`);

      // מנגנון הגנה: אם הנתונים תקועים ולא זזים מעל 4 דקות (כשיש כבר דאטה), נחלץ מוקדם
      if (itemCount !== null && itemCount > 50 && itemCount === lastItemCount) {
        noProgressCycles++;
        if (noProgressCycles >= 12) { // 12 * 20 שניות = 4 דקות
          console.log(`\n[!] Progress stuck at ${itemCount} items. Exiting early to save data.`);
          earlyExit = true;
          break;
        }
      } else {
        noProgressCycles = 0;
      }
      
      if (itemCount !== null) lastItemCount = itemCount;

      console.log(`Waiting 20 seconds for next check...`);
      await new Promise(resolve => setTimeout(resolve, 20000));

      const statusResponse = await fetch(`https://api.apify.com/v2/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
      }
    }

    // 3. הורדת הנתונים
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);

    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. עיבוד המידע בהתאם למבנה השדות של האקטור הרשמי של Apify
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        // באקטור הרשמי הטקסט המלא נמצא לרוב ב-fullText או text
        const text = item.fullText || item.text || '';
        if (!text) return null;

        // חילוץ שם משתמש נקי
        const rawUsername = item.twitterUser?.username || item.username || 'unknown';
        const username = String(rawUsername).replace('@', '');
        
        // חילוץ תאריך וזמן
        const createdAt = item.createdAt || item.created_at || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        // חילוץ מדיה (תמונות/סרטונים) בצורה מותאמת לאקטור הרשמי
        let media = [];
        if (Array.isArray(item.media)) {
          media = item.media.map(m => m.url || m.media_url_https).filter(Boolean);
        }

        return {
          id: item.id || String(item.tweetId) || String(timestamp),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          tweet_url: item.url || item.tweet_url || null,
          media: [...new Set(media)]
        };
      })
      .filter(item => item !== null);

    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // 5. מיזוג ושמירה
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
    console.log(`\nFinished! Total tweets in database: ${finalTweets.length}`);

    if (earlyExit && (status === 'RUNNING' || status === 'READY')) {
      await fetch(`https://api.apify.com/v2/runs/${runId}/abort?token=${APIFY_TOKEN}`, { method: 'POST' }).catch(() => {});
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1);
  }
})();
