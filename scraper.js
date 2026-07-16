const fs = require('fs');

const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

// פונקציה לפענוח תווים מיוחדים של HTML
function decodeHtml(html) {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// פונקציה לשאיבת ציוצים משרת Nitter/XCancel כגיבוי
async function fetchFromNitterFallback(username) {
  try {
    const response = await fetch(`https://xcancel.com/${username}/rss`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000)
    });
    
    if (!response.ok) return [];
    const xmlText = await response.text();
    
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const descriptionRegex = /<description>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/description>/;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid(?: [^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/guid>/;

    const tweets = [];
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const item = match[1];
      const descM = item.match(descriptionRegex);
      const pubM = item.match(pubDateRegex);
      const guidM = item.match(guidRegex);

      const description = descM ? (descM[1] || descM[2] || '') : '';
      const pubDateStr = pubM ? pubM[1] : '';
      const guid = guidM ? (guidM[1] || guidM[2] || '') : '';

      if (!guid) continue;
      const tweetIdMatch = guid.match(/\/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : guid;

      let cleanText = description.replace(/<img[^>]*>/gi, '').replace(/<[^>]*>/g, '').trim();
      cleanText = decodeHtml(cleanText);

      const media = [];
      const mediaRegex = /<img[^+]+src=["']([^"']+)["']/gi;
      let imgMatch;
      while ((imgMatch = mediaRegex.exec(description)) !== null) {
        let imgUrl = imgMatch[1];
        if (imgUrl.includes('/pic/media/')) {
          imgUrl = `https://pbs.twimg.com/media/${imgUrl.split('/pic/media/')[1]}`;
        }
        media.push(imgUrl);
      }

      tweets.push({
        id: tweetId,
        username: username,
        text: cleanText,
        created_at: pubDateStr,
        timestamp: pubDateStr ? new Date(pubDateStr).getTime() : Date.now(),
        media: media
      });
    }
    return tweets;
  } catch (e) {
    return [];
  }
}

(async () => {
  console.log(`Starting Advanced Twitter Scraper for ${twitterUsernames.length} users...`);
  let allTweets = [];

  for (const username of twitterUsernames) {
    console.log(`Fetching: @${username}...`);
    let userTweets = [];

    // ניסיון ראשון: API של vxtwitter
    try {
      const response = await fetch(`https://api.vxtwitter.com/${username}`, {
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const data = await response.json();
        const rawTweets = data.tweets || [];
        userTweets = rawTweets.map(t => ({
          id: t.id_str || String(t.tweetID),
          username: username,
          text: t.text || '',
          created_at: t.date || new Date().toUTCString(),
          timestamp: t.date_epoch ? (t.date_epoch * 1000) : Date.now(),
          media: t.media_urls || []
        }));
      }
    } catch (err) {
      // נכשל או לקח יותר מדי זמן, נמשיך לגיבוי
    }

    // ניסיון שני: אם ה-API החזיר ריק, מפעילים גיבוי מ-XCancel
    if (userTweets.length === 0) {
      console.log(`  -> No data from API. Trying XCancel backup for @${username}...`);
      userTweets = await fetchFromNitterFallback(username);
    }

    if (userTweets.length > 0) {
      console.log(`  -> Success! Found ${userTweets.length} tweets.`);
      allTweets = allTweets.concat(userTweets);
    } else {
      console.log(`  -> Could not fetch any tweets for @${username}`);
    }

    // השהייה קלה
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // מיון כל הציוצים מהחדש ביותר לישן ביותר
  allTweets.sort((a, b) => b.timestamp - a.timestamp);

  // שמירה לקובץ (אם מצאנו לפחות משהו אחד, נעדכן את הקובץ כדי שגוגל יקרא ציוצים חדשים)
  if (allTweets.length > 0) {
    fs.writeFileSync('tweets.json', JSON.stringify(allTweets, null, 2));
    console.log(`\nDone! Total of ${allTweets.length} tweets written to tweets.json.`);
  } else {
    console.log("\nNo tweets collected from any source.");
  }
})();
