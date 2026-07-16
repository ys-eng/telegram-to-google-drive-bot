const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

// רשימת המשתמשים שאתה עוקב אחריהם
const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

(async () => {
  console.log(`Starting Apify Twitter Scraper for ${twitterUsernames.length} users...`);

  // הגדרת הפרמטרים לבוט הרשמי
  const input = {
    "twitterHandles": twitterUsernames,
    "maxTweets": 40, 
    "maxTweetsPerQuery": 2, 
    "scrapeType": "tweets"
  };

  const actorName = "apidojo~tweet-scraper"; 

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
    const runId = runData.data.id;
    const defaultDatasetId = runData.data.defaultDatasetId;
    console.log(`Run started successfully! Run ID: ${runId}`);

    // 2. המתנה לסיום הריצה ב-Apify
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 5 * 60 * 1000; 

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log("Waiting for Apify to finish scraping (checking status in 15 seconds)...");
      await new Promise(resolve => setTimeout(resolve, 15000));

      const statusResponse = await fetch(`https://api.apify.com/v2/acts/${actorName}/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
        console.log(`Current status: ${status}`);
      }
    }

    if (status !== 'SUCCEEDED') {
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

    // 4. עיבוד וסינון המידע למבנה הרצוי (מותאם למבנה החדש של Apidojo)
    const formattedTweets = rawItems
      .map(item => {
        if (!item) return null;

        // חילוץ טקסט - מנסה ממספר מקומות אפשריים ב-JSON של Apidojo
        const text = item.full_text || item.text || (item.legacy && item.legacy.full_text) || '';
        
        // אם אין טקסט בכלל, נתעלם מהפריט הזה
        if (!text) return null;

        // חילוץ שם המשתמש
        let username = 'unknown';
        if (item.user && item.user.screen_name) {
          username = item.user.screen_name;
        } else if (item.core && item.core.user_results && item.core.user_results.result && item.core.user_results.result.legacy) {
          username = item.core.user_results.result.legacy.screen_name;
        } else if (item.legacy && item.legacy.user_id_str) {
          username = item.legacy.user_id_str; // גיבוי
        }

        // חילוץ תאריך
        const createdAt = item.created_at || (item.legacy && item.legacy.created_at) || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        // חילוץ תמונות וסרטונים
        const media = [];
        const mediaSource = item.extended_entities || item.entities || (item.legacy && item.legacy.extended_entities) || (item.legacy && item.legacy.entities);
        
        if (mediaSource && mediaSource.media) {
          mediaSource.media.forEach(m => {
            if (m.media_url_https) media.push(m.media_url_https);
          });
        }

        return {
          id: item.id_str || (item.legacy && item.legacy.id_str) || String(item.id),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          media: media
        };
      })
      .filter(item => item !== null); // מסנן החוצה פריטים שלא הצלחנו לחלץ מהם טקסט

    // מיון מהחדש ביותר לישן ביותר
    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // 5. שמירת המידע לקובץ מקומי
    if (formattedTweets.length > 0) {
      fs.writeFileSync('tweets.json', JSON.stringify(formattedTweets, null, 2));
      console.log(`\nFinished! Successfully updated tweets.json with ${formattedTweets.length} tweets.`);
    } else {
      // הדפסת דוגמה קטנה מהמבנה הגולמי ללוג כדי שנוכל לחקור במקרה של כשל
      console.log("Raw item example:", JSON.stringify(rawItems[0], null, 2));
      throw new Error("Scraping finished but no valid tweets could be parsed from the dataset.");
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1); 
  }
})();
