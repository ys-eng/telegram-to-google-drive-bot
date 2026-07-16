const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

// רשימת כל המשתמשים
const allTwitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

// פונקציה לבחירת X משתמשים אקראיים מהרשימה
function getRandomBatch(arr, size) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, size);
}

// נבחר 3 משתמשים אקראיים בכל ריצה כדי שהסריקה תסתיים תוך 2 דקות
const activeBatch = getRandomBatch(allTwitterUsernames, 3);

(async () => {
  console.log(`Starting Free Apify Twitter Scraper for a random batch of ${activeBatch.length} users:`);
  console.log(`Selected users: ${activeBatch.join(', ')}`);

  // המרת המשתמשים שנבחרו למבנה ה-startUrls הסטנדרטי
  const startUrls = activeBatch.map(username => ({
    url: `https://x.com/${username}`
  }));

  const input = {
    "startUrls": startUrls,
    "maxTweets": 15 // 15 ציוצים למשתמש זה מעל ומעבר כדי לקבל את העדכונים האחרונים
  };

  const actorName = "motx11~twitter-x-scraper-fxtwitter"; 
  let runId = null;

  try {
    console.log(`Calling Free Apify Actor (${actorName.replace('~', '/')})...`);
    
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

    // 2. המתנה לסיום הריצה ב-Apify (עם מגבלת זמן שפויה של 8 דקות כעת)
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 8 * 60 * 1000; 

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Waiting 15 seconds for next check...`);
      await new Promise(resolve => setTimeout(resolve, 15000));

      const statusResponse = await fetch(`https://api.apify.com/v2/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
      }
    }

    console.log(`Apify run finished with status: ${status}`);

    // אם הריצה נכשלה
    if (status !== 'SUCCEEDED') {
      console.log(`\n[!] Run failed with status: ${status}. Fetching internal Apify logs for diagnostics...`);
      try {
        const logResponse = await fetch(`https://api.apify.com/v2/run-logs/${runId}?token=${APIFY_TOKEN}`);
        const logText = await logResponse.text();
        
        console.log("\n=================== APIFY INTERNAL LOGS ===================");
        if (logText) {
          console.log(logText.split('\n').slice(-40).join('\n'));
        } else {
          console.log("No logs returned from Apify or logs are empty.");
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
    const formattedTweets = rawItems
      .map(item => {
        if (!item || item.noResults || item.demo) return null;

        const text = item.text || item.fullText || item.full_text || (item.legacy && item.legacy.full_text) || '';
        if (!text) return null;

        let username = 'unknown';
        if (item.author && item.author.screen_name) {
          username = item.author.screen_name;
        } else if (item.user && (item.user.screen_name || item.user.username)) {
          username = item.user.screen_name || item.user.username;
        } else if (item.username) {
          username = item.username;
        }

        const createdAt = item.createdAt || item.created_at || item.date || (item.legacy && item.legacy.created_at) || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        let media = [];
        if (item.media && Array.isArray(item.media)) {
          media = item.media.map(m => typeof m === 'string' ? m : (m.url || m.media_url_https || m.thumbnail_url));
        } else if (item.images && Array.isArray(item.images)) {
          media = item.images;
        }

        return {
          id: item.id_str || item.idStr || String(item.id || ''),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          media: media.filter(Boolean)
        };
      })
      .filter(item => item !== null);

    // מיון מהחדש ביותר לישן ביותר
    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // 5. שמירת המידע לקובץ מקומי (במצב של Append/Merge חכם כדי לא למחוק ציוצים קודמים)
    let existingTweets = [];
    if (fs.existsSync('tweets.json')) {
      try {
        existingTweets = JSON.parse(fs.readFileSync('tweets.json', 'utf8'));
      } catch (e) {
        existingTweets = [];
      }
    }

    // מיזוג ציוצים חדשים עם ישנים ומניעת כפילויות לפי ה-ID של הציוץ
    const allTweetsMap = new Map();
    existingTweets.forEach(t => allTweetsMap.set(t.id, t));
    formattedTweets.forEach(t => allTweetsMap.set(t.id, t));

    const mergedTweets = Array.from(allTweetsMap.values());
    mergedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // נשמור רק את 100 הציוצים הכי אחרונים בסך הכל כדי שהקובץ לא יתנפח
    const finalTweets = mergedTweets.slice(0, 100);

    fs.writeFileSync('tweets.json', JSON.stringify(finalTweets, null, 2));
    console.log(`\nFinished! Successfully updated tweets.json. Total tweets in database: ${finalTweets.length}`);

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1); 
  }
})();
