const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error("Critical Error: APIFY_TOKEN is missing in environment variables!");
  process.exit(1);
}

const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

(async () => {
  console.log(`Starting Apify Twitter Scraper for ${twitterUsernames.length} users...`);

  // הגדרת הפרמטרים לבוט של Apify
  const input = {
    handle: twitterUsernames,
    tweetsDesired: 3, // מושך את ה-3 האחרונים מכל אחד (חוסך זמן ומשאבים)
    addParentTweets: false,
    maxItems: 80,
    proxyConfig: { useApifyProxy: true } // שימוש בפרוקסי של Apify לעקיפת חסימות
  };

  try {
    console.log("Calling Apify Actor (apify/twitter-scraper)...");
    
    // 1. הפעלת ה-Actor ב-Apify
    const runResponse = await fetch(`https://api.apify.com/v2/acts/apify~twitter-scraper/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });

    if (!runResponse.ok) {
      throw new Error(`Failed to start Apify run: ${runResponse.statusText}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;
    const defaultDatasetId = runData.data.defaultDatasetId;
    console.log(`Run started successfully. Run ID: ${runId}`);

    // 2. המתנה לסיום הריצה (פולר/Polling פשוט)
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 4 * 60 * 1000; // הגבלת המתנה ל-4 דקות

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log("Waiting for Apify to finish scraping (checking status in 15s)...");
      await new Promise(resolve => setTimeout(resolve, 15000));

      const statusResponse = await fetch(`https://api.apify.com/v2/acts/apify~twitter-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
        console.log(`Current status: ${status}`);
      }
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run finished with non-success status: ${status}`);
    }

    // 3. שליפת התוצאות ממאגר המידע (Dataset) של הריצה
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);
    
    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. מיפוי וניקוי המידע למבנה המוכר שלך
    const formattedTweets = rawItems
      .filter(item => item && item.text) // סינון פריטים ריקים
      .map(item => {
        const media = [];
        if (item.media && Array.isArray(item.media)) {
          item.media.forEach(m => {
            if (m.media_url_https) media.push(m.media_url_https);
          });
        }

        return {
          id: item.id_str || String(item.id),
          username: item.user ? item.user.screen_name : 'unknown',
          text: item.text,
          created_at: item.created_at || new Date().toUTCString(),
          timestamp: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
          media: media
        };
      });

    // מיון מהחדש ביותר לישן ביותר
    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // שמירה
    if (formattedTweets.length > 0) {
      fs.writeFileSync('tweets.json', JSON.stringify(formattedTweets, null, 2));
      console.log(`\nFinished! Successfully updated tweets.json with ${formattedTweets.length} tweets.`);
    } else {
      console.log("\nNo valid tweets were processed from Apify.");
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
  }
})();
