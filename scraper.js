const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

// TODO: החלף את המחרוזת הזו ב-Task ID האלפאנומרי החדש שקיבלת מה-Console עבור האקטור החדש
const APIFY_TASK_ID = 'knAaAfDNMgF4XVXLo'; 

// היעד החדש שלנו: 23 משתמשים כפול 15 ציוצים = 345
const TARGET_ITEMS = 345; 

(async () => {
  console.log(`Starting Microworlds Twitter Scraper via Task ID [${APIFY_TASK_ID}]...`);

  let runId = null;

  try {
    console.log(`Triggering Apify Task...`);

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
    const timeoutLimit = 15 * 60 * 1000; // 15 דקות לגיבוי
    
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

      if (itemCount !== null) {
        // אם הגענו ליעד - נחלץ מוקדם כדי לחסוך זמן ומשאבים
        if (itemCount >= TARGET_ITEMS) {
          console.log(`\n[✓] Target reached (${itemCount}/${TARGET_ITEMS}). Exiting loop early!`);
          earlyExit = true;
          break;
        }

        // הגנה מפני תקיעה (3 דקות ללא שינוי)
        if (itemCount > 20 && itemCount === lastItemCount) {
          noProgressCycles++;
          if (noProgressCycles >= 9) { 
            console.log(`\n[!] Progress stuck at ${itemCount} items. Exiting early to save data.`);
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

    // 3. הורדת הנתונים
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);

    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. עיבוד המידע בהתאמה למבנה של microworlds
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        // האקטור הזה משתמש ב-text או full_text
        const text = item.text || item.full_text || item.fullText || '';
        if (!text) return null;

        // חילוץ שם משתמש נקי מהמבנה של האקטור החדש
        const rawUsername = item.user?.username || item.user?.screen_name || item.username || 'unknown';
        const username = String(rawUsername).replace('@', '');
        
        const createdAt = item.created_at || item.createdAt || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        // חילוץ מדיה
        let media = [];
        if (Array.isArray(item.media)) {
          media = item.media.map(m => m.media_url_https || m.url || m).filter(Boolean);
        } else if (item.extended_entities?.media && Array.isArray(item.extended_entities.media)) {
          media = item.extended_entities.media.map(m => m.media_url_https || m.url).filter(Boolean);
        }

        return {
          id: item.id_str || item.id || String(timestamp),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          tweet_url: item.url || (item.id_str ? `https://twitter.com/${username}/status/${item.id_str}` : null),
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

    // ביטול הריצה במידה והיא עדיין פעילה ברקע כדי לחסוך Compute Units
    if (earlyExit && (status === 'RUNNING' || status === 'READY')) {
      console.log("Sending abort signal to Apify...");
      await fetch(`https://api.apify.com/v2/runs/${runId}/abort?token=${APIFY_TOKEN}`, { method: 'POST' }).catch(() => {});
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1);
  }
})();
