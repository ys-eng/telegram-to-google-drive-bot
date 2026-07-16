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

  // הגדרת הפרמטרים לבוט המעודכן של Apidojo
  const input = {
    "twitterHandles": twitterUsernames,
    "maxTweets": 40, // סך הכל ציוצים שנרצה לאסוף בריצה הזו
    "maxTweetsPerQuery": 2, // 2 ציוצים אחרונים מכל פרופיל (חוסך המון קרדיט וזמן)
    "scrapeType": "tweets"
  };

  try {
    console.log("Calling Apify Actor (apidojo/tweets-scraper)...");
    
    // 1. הפעלת ה-Actor המעודכן של Apidojo
    const runResponse = await fetch(`https://api.apify.com/v2/acts/apidojo~tweets-scraper/runs?token=${APIFY_TOKEN}`, {
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

    // 2. המתנה לסיום הריצה
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 5 * 60 * 1000; // הגבלת המתנה ל-5 דקות

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log("Waiting for Apify to finish scraping (checking status in 15 seconds)...");
      await new Promise(resolve => setTimeout(resolve, 15000));

      const statusResponse = await fetch(`https://api.apify.com/v2/acts/apidojo~tweets-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
        console.log(`Current status: ${status}`);
      }
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run finished with non-success status: ${status}`);
    }

    // 3. שליפת התוצאות ממאגר המידע
    console.log("Downloading scraped data from dataset...");
    const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}`);
    
    if (!datasetResponse.ok) {
      throw new Error("Failed to download dataset items.");
    }

    const rawItems = await datasetResponse.json();
    console.log(`Retrieved ${rawItems.length} items from Apify.`);

    // 4. מיפוי וניקוי המידע למבנה המוכר של גוגל שיטס
    const formattedTweets = rawItems
      .filter(item => item && (item.full_text || item.text)) // סינון פריטים ריקים
      .map(item => {
        // לפעמים המפתח נקרא text ולפעמים full_text ב-API החדש
        const text = item.full_text || item.text || '';
        
        // חילוץ תמונות וסרטונים
        const media = [];
        if (item.extended_entities && item.extended_entities.media) {
          item.extended_entities.media.forEach(m => {
            if (m.media_url_https) media.push(m.media_url_https);
          });
        } else if (item.entities && item.entities.media) {
          item.entities.media.forEach(m => {
            if (m.media_url_https) media.push(m.media_url_https);
          });
        }

        return {
          id: item.id_str || String(item.id),
          username: item.user ? item.user.screen_name : 'unknown',
          text: text,
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
      throw new Error("Scraping finished but no valid tweets were found in the dataset.");
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1); // גורם ל-GitHub Actions להציג איקס אדום אם הריצה באמת נכשלה!
  }
})();
