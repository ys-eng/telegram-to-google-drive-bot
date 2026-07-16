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
  console.log(`Starting Free Apify Twitter Scraper for ${twitterUsernames.length} users...`);

  // המרת המשתמשים לשאילתות חיפוש בפורמט "from:username"
  const searchQueries = twitterUsernames.map(username => `from:${username}`);

  // הגדרת הפרמטרים ל-Actor החינמי (microworlds/twitter-scraper)
  const input = {
    "searchTerms": searchQueries,
    "maxTweets": 40,
    "tweetsSearchMode": "Latest"
  };

  // מזהה ה-Actor החינמי ב-Apify API
  const actorName = "microworlds~twitter-scraper"; 

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
    const runId = runData.data.id;
    const defaultDatasetId = runData.data.defaultDatasetId;
    console.log(`Run started successfully! Run ID: ${runId}`);

    // 2. המתנה לסיום הריצה ב-Apify
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 7 * 60 * 1000; // הגדלנו ל-7 דקות כי בוטים חינמיים לפעמים לוקחים קצת יותר זמן

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

    // 4. עיבוד וסינון המידע למבנה הרצוי
    // יצרנו מנגנון חילוץ סופר-גמיש (Robust Extraction) שמחפש שדות תחת כל השמות האפשריים שלהם
    const formattedTweets = rawItems
      .map(item => {
        if (!item || item.noResults || item.demo) return null;

        // איתור טקסט הציוץ
        const text = item.fullText || item.text || item.full_text || (item.legacy && item.legacy.full_text) || '';
        if (!text) return null;

        // איתור שם המשתמש
        let username = 'unknown';
        if (item.user && (item.user.screenName || item.user.screen_name || item.user.username)) {
          username = item.user.screenName || item.user.screen_name || item.user.username;
        } else if (item.username || item.screenName) {
          username = item.username || item.screenName;
        } else if (item.core && item.core.user_results && item.core.user_results.result && item.core.user_results.result.legacy) {
          username = item.core.user_results.result.legacy.screen_name;
        }

        // איתור תאריך וחתימת זמן
        const createdAt = item.createdAt || item.created_at || item.date || (item.legacy && item.legacy.created_at) || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        // איתור תמונות/סרטונים במבנה של Microworlds (בדרך כלל במערך בשם images או media)
        let media = [];
        if (item.images && Array.isArray(item.images)) {
          media = item.images;
        } else if (item.media && Array.isArray(item.media)) {
          media = item.media.map(m => typeof m === 'string' ? m : (m.url || m.media_url_https));
        } else {
          const legacyMedia = item.extended_entities || item.entities || (item.legacy && item.legacy.extended_entities);
          if (legacyMedia && legacyMedia.media) {
            legacyMedia.media.forEach(m => {
              if (m.media_url_https) media.push(m.media_url_https);
            });
          }
        }

        return {
          id: item.id_str || item.idStr || (item.legacy && item.legacy.id_str) || String(item.id || ''),
          username: username,
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
          media: media
        };
      })
      .filter(item => item !== null);

    // מיון מהחדש ביותר לישן ביותר
    formattedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // 5. שמירת המידע לקובץ מקומי
    if (formattedTweets.length > 0) {
      fs.writeFileSync('tweets.json', JSON.stringify(formattedTweets, null, 2));
      console.log(`\nFinished! Successfully updated tweets.json with ${formattedTweets.length} tweets.`);
    } else {
      if (rawItems.length > 0) {
        console.log("Raw item example to help debug:", JSON.stringify(rawItems[0], null, 2));
      }
      throw new Error("Scraping finished but no valid tweets could be parsed from the dataset.");
    }

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1); 
  }
})();
