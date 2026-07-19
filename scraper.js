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

(async () => {
  console.log(`Starting Stable Apify Twitter Scraper (altimis/scweet) for ${twitterUsernames.length} users...`);

  // המרת שמות המשתמשים לכתובות URL בפורמט שהאקטורים של Apify מצפים לקבל
  const startUrls = twitterUsernames.map(username => ({
    url: `https://x.com/${username}`
  }));

  // הגדרת הקלט (Input) המעודכן עם startUrls במקום profiles
  const input = {
    "startUrls": startUrls,
    "tweetsDesired": 15, // במידה והוא דורש משהו אחר לשליטה בכמות נעדכן, אבל זה מה שהיה מקודם
    "proxyConfig": {
      "useApifyProxy": true
    }
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

    // 2. המתנה לסיום הריצה ב-Apify (12 דקות למקסימום בטיחות)
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
    const formattedTweets = rawItems
      .map(item => {
        if (!item || item.noResults) return null;

        const text = item.text || item.fullText || item.full_text || '';
        if (!text) return null;

        const username = item.username || item.screenName || (item.author && item.author.screen_name) || 'unknown';
        const createdAt = item.createdAt || item.created_at || item.date || new Date().toUTCString();
        const timestamp = new Date(createdAt).getTime() || Date.now();

        let media = [];
        
        if (item.videoUrl || item.video_url) {
          media.push(item.videoUrl || item.video_url);
        } else if (item.extendedEntities && item.extendedEntities.media) {
          item.extendedEntities.media.forEach(m => {
            if (m.video_info && m.video_info.variants) {
              const mp4s = m.video_info.variants
                .filter(v => v.url && v.url.includes('.mp4'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              if (mp4s.length > 0) media.push(mp4s[0].url);
            }
          });
        }

        if (item.images && Array.isArray(item.images)) {
          media = media.concat(item.images);
        } else if (item.media && Array.isArray(item.media)) {
          item.media.forEach(m => {
            if (typeof m === 'string') media.push(m);
            else if (m.url || m.media_url_https) media.push(m.url || m.media_url_https);
          });
        }

        return {
          id: item.id || item.id_str || String(timestamp),
          username: username.replace('@', ''),
          text: text,
          created_at: createdAt,
          timestamp: timestamp,
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
