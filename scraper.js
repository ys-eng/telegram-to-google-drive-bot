const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

// TODO: החלף את המחרוזת הזו ב-Task ID האלפאנומרי האמיתי שלך מה-Console (למשל: 'HG7ML7M8z78ycAPEB')
const APIFY_TASK_ID = 'YOUR_ALPHANUMERIC_TASK_ID_HERE'; 

// היעד שלנו: 23 משתמשים כפול 15 ציוצים = 345.
const TARGET_ITEMS = 345; 

(async () => {
  console.log(`Starting Apify Twitter Scraper via Task ID [${APIFY_TASK_ID}]...`);
  console.log(`Target items to collect early: ${TARGET_ITEMS}`);

  let runId = null;

  try {
    console.log(`Triggering Apify Task...`);

    // הכתובת הרשמית והמדויקת של Apify לניהול משימות
    const runResponse = await fetch(`https://api.apify.com/v2/actor-tasks/${APIFY_TASK_ID}/runs?token=${APIFY_TOKEN}`, {
      method: 'POST'
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      throw new Error(`Failed to start Apify Task: ${runResponse.status} - ${errorText}`);
    }

    const runData = await runResponse.json();
    runId = runData.data.id;
    const defaultDatasetId = runData.data.defaultDatasetId;
    console.log(`Task run started successfully! Run ID: ${runId}`);
    console.log(`Monitor live here: https://console.apify.com/actors/runs/${runId}`);

    // 2. המתנה לריצה עם מעקב התקדמות וחילוץ מוקדם
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 20 * 60 * 1000; // 20 דקות לגיבוי
    
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
      } catch (e) {
        // שגיאה לא קריטית בתשאול הסטטוס, נמשיך בריצה
      }

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Items collected so far: ${itemCount !== null ? itemCount : 'unknown'}.`);

      if (itemCount !== null) {
        // בדיקה 1: האם הגענו ליעד הציוצים שלנו?
        if (itemCount >= TARGET_ITEMS) {
          console.log(`\n[✓] Target reached (${itemCount}/${TARGET_ITEMS}). Exiting loop early to process data and save limits!`);
          earlyExit = true;
          break;
        }

        // בדיקה 2: מנגנון הגנה מפני תקיעה של השרת (3 דקות ללא שינוי)
        if (itemCount > 50 && itemCount === lastItemCount) {
          noProgressCycles++;
          if (noProgressCycles >= 9) { 
            console.log(`\n[!] Progress stuck at ${itemCount} items. Exiting early to save collected data.`);
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

    if (!earlyExit && status !== 'SUCCEEDED') {
      throw new Error(`Apify run finished with non-success status: ${status}.`);
    }

    // 3. הורדת הנתונים שנאספו ב-Dataset
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);

    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. עיבוד המידע והתאמתו למבנה השדות של API Dojo
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        const text = item.fullText || item.text || (item.tweet && item.tweet.text) || '';
        if (!text) return null;

        const rawUsername = item.twitterUser?.username || (item.user && (item.user.username || item.user.screen_name)) || item.username || item.handle || 'unknown';
        const username = String(rawUsername).replace('@', '');
        
        const createdAt = item.createdAt || item.created_at || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        let media = [];
        if (Array.isArray(item.media)) {
          media = item.media.map(m => m.url || m.media_url_https || m).filter(Boolean);
        } else if (item.extendedEntities && Array.isArray(item.extendedEntities.media)) {
          media = item.extendedEntities.media.map(m => m.media_url_https || m.url).filter(Boolean);
        } else if (item.tweet && Array.isArray(item.tweet.media)) {
          media = item.tweet.media;
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

    // 5. מיזוג חכם עם קובץ ה-JSON הקיים
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

    // כיבוי יזום של הקונטיינר במידה ועצרנו מוקדם כדי לשמור על הקרדיט החינמי שלך
    if (earlyExit && (status === 'RUNNING' || status === 'READY')) {
      console.log("Sending abort signal to Apify to terminate the active container and save credit...");
      await fetch(`https://api.apify.com/v2/runs/${runId}/abort?token=${APIFY_TOKEN}`, { method: 'POST' }).catch(() => {});
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1);
  }
})();
