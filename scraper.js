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
  console.log(`Starting Stable Apify Twitter Scraper (altimis/scweet) for ${twitterUsernames.length} users...`);

  // הקלט הנכון עבור altimis/scweet:
  // - source_mode: "search" + from_users (שדה מובנה) במקום searchQueries
  // - max_items: מינימום 100 (האקטור אוכף זאת בעצמו)
  // - search_sort: "Latest" מומלץ כשסורקים כמה משתמשים כדי לקבל טוויטים עדכניים מכולם
  // - אין proxyConfig - מפתחות לא מוכרים נדחים על ידי הסכימה
  const input = {
    "source_mode": "search",
    "from_users": twitterUsernames,
    "max_items": Math.max(100, twitterUsernames.length * TWEETS_PER_USER),
    "search_sort": "Latest"
  };

  const actorName = "altimis~scweet";
  let runId = null;

  try {
    console.log(`Calling Apify Actor (${actorName.replace('~', '/')})...`);

    // 1. הפעלת הריצה (Run) ב-Apify
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

    // 2. המתנה לסיום הריצה ב-Apify
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 12 * 60 * 1000;

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Waiting 20 seconds for next check...`);
      await new Promise(resolve => setTimeout(resolve, 20000));

      const statusResponse = await fetch(`https://api.apify.com/v2/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
      }
    }

    console.log(`Apify run finished with status: ${status}`);

    if (status !== 'SUCCEEDED') {
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

      throw new Error(`Apify run finished with non-success status: ${status}`);
    }

    // 3. שליפת המידע הגולמי שנאסף (Dataset)
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);

    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. עיבוד וסינון המידע למבנה הרצוי
    // סכימת הפלט של altimis/scweet: id, text, handle, created_at, tweet_url, tweet.media (מערך)
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        const text = item.text || '';
        if (!text) return null;

        const username = item.handle || 'unknown';
        const createdAt = item.created_at || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        let media = [];
        if (item.tweet && Array.isArray(item.tweet.media)) {
          media = item.tweet.media;
        }

        return {
          id: item.id || String(timestamp),
          username: username.replace('@', ''),
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

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1);
  }
})();
