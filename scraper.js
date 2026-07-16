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

// בחירת משתמש אקראי אחד בלבד לריצה מהירה ובטוחה
const randomUser = allTwitterUsernames[Math.floor(Math.random() * allTwitterUsernames.length)];

(async () => {
  console.log(`[Safe Mode] Starting Free Apify Twitter Scraper for exactly 1 user: @${randomUser}`);

  const startUrls = [{
    url: `https://x.com/${randomUser}`
  }];

  const input = {
    "startUrls": startUrls,
    "maxTweets": 10 // 10 ציוצים אחרונים מספיקים בהחלט לריצה שוטפת
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

    // 2. המתנה לסיום הריצה ב-Apify (מגבלת זמן של 6 דקות)
    let status = 'RUNNING';
    const startTime = Date.now();
    const timeoutLimit = 6 * 60 * 1000; 

    while (status === 'RUNNING' || status === 'READY') {
      if (Date.now() - startTime > timeoutLimit) {
        throw new Error("Timeout reached while waiting for Apify to finish.");
      }

      console.log(`[${new Date().toLocaleTimeString()}] Status: ${status}. Waiting 15 seconds...`);
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

    // 4. עיבוד וסינון המידע למבנה הרצוי (כולל חילוץ וידאו ותמונות מורחב)
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

        // מערך המדיה המאוחד - יכיל תמונות וסרטונים
        let media = [];

        // 1. ניסיון לחלץ סרטונים (MP4) במידה וקיימים
        if (item.videoInfo || item.video_info) {
          const info = item.videoInfo || item.video_info;
          if (info.variants && Array.isArray(info.variants)) {
            // סינון של קבצי mp4 בלבד ומיון לפי bitrate כדי לקבל את האיכות הכי גבוהה
            const mp4Videos = info.variants
              .filter(v => v.content_type === 'video/mp4' || (v.url && v.url.includes('.mp4')))
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            
            if (mp4Videos.length > 0) {
              media.push(mp4Videos[0].url); // הוספת הקישור הישיר לסרטון
            }
          }
        }

        // 2. ניסיון לחלץ תמונות רגילות
        if (item.media && Array.isArray(item.media)) {
          item.media.forEach(m => {
            if (typeof m === 'string') {
              media.push(m);
            } else {
              // לפעמים הסרטון מתחבא בתוך ה-media array תחת סוג video
              if (m.type === 'video' && m.video_info && m.video_info.variants) {
                const mp4s = m.video_info.variants
                  .filter(v => v.url && v.url.includes('.mp4'))
                  .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (mp4s.length > 0) media.push(mp4s[0].url);
              } else {
                media.push(m.url || m.media_url_https || m.thumbnail_url);
              }
            }
          });
        } else if (item.images && Array.isArray(item.images)) {
          media = media.concat(item.images);
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

    // 5. שמירת המידע לקובץ מקומי במצב של Merge
    let existingTweets = [];
    if (fs.existsSync('tweets.json')) {
      try {
        existingTweets = JSON.parse(fs.readFileSync('tweets.json', 'utf8'));
      } catch (e) {
        existingTweets = [];
      }
    }

    // מיזוג ציוצים חדשים ומניעת כפילויות
    const allTweetsMap = new Map();
    existingTweets.forEach(t => allTweetsMap.set(t.id, t));
    formattedTweets.forEach(t => allTweetsMap.set(t.id, t));

    const mergedTweets = Array.from(allTweetsMap.values());
    mergedTweets.sort((a, b) => b.timestamp - a.timestamp);

    // הגבלת כמות הציוצים הכללית במאגר ל-150 כדי שהקובץ יישאר קל ומהיר
    const finalTweets = mergedTweets.slice(0, 150);

    fs.writeFileSync('tweets.json', JSON.stringify(finalTweets, null, 2));
    console.log(`\nFinished! Successfully processed @${randomUser}. Total tweets in database: ${finalTweets.length}`);

  } catch (error) {
    console.error("Critical Scraping Error:", error.message);
    process.exit(1); 
  }
})();
