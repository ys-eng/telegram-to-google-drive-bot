const fs = require('fs');

// רשימת החשבונות שביקשת לעקוב אחריהם
const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

// שרתי Nitter פעילים ואיכותיים (עם עדיפות ל-XCancel) למקרה ששרת מסוים עמוס או חסום
const NITTER_INSTANCES = [
  'https://xcancel.com',
  'https://nitter.privacydev.net',
  'https://nitter.d420.de',
  'https://nitter.it'
];

// פונקציה לפענוח תווים מיוחדים של HTML (כמו &amp; ל- &)
function decodeHtml(html) {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// פונקציה שמפרקת את ה-XML של ה-RSS למערך ציוצים מסודר
function parseNitterRss(xmlText, username) {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/;
  const descriptionRegex = /<description>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/description>/;
  const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
  const guidRegex = /<guid(?: [^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/guid>/;

  const tweets = [];
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
    const itemContent = itemMatch[1];

    const titleM = itemContent.match(titleRegex);
    const descM = itemContent.match(descriptionRegex);
    const pubM = itemContent.match(pubDateRegex);
    const guidM = itemContent.match(guidRegex);

    const title = titleM ? (titleM[1] || titleM[2] || '') : '';
    const description = descM ? (descM[1] || descM[2] || '') : '';
    const pubDateStr = pubM ? pubM[1] : '';
    const guid = guidM ? (guidM[1] || guidM[2] || '') : '';

    if (!guid) continue;

    // חילוץ מזהה הציוץ (ID) מתוך הקישור
    const tweetIdMatch = guid.match(/\/status\/(\d+)/);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : guid;

    // ניקוי תגיות HTML מטקסט הציוץ
    let cleanText = description.replace(/<img[^>]*>/gi, ''); // הסרת תגיות תמונות קודם
    cleanText = cleanText.replace(/<[^>]*>/g, '').trim(); // הסרת שאר תגיות ה-HTML
    cleanText = decodeHtml(cleanText);

    if (!cleanText && title) {
      cleanText = decodeHtml(title);
    }

    // חילוץ תמונות ומדיה מהציוץ
    const media = [];
    const mediaRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let imgMatch;
    while ((imgMatch = mediaRegex.exec(description)) !== null) {
      let imgUrl = imgMatch[1];
      imgUrl = decodeURIComponent(imgUrl);
      
      // המרת כתובות התמונות של Nitter בחזרה לכתובות המקוריות של Twitter/X
      if (imgUrl.includes('/pic/media/')) {
        const filename = imgUrl.split('/pic/media/')[1];
        imgUrl = `https://pbs.twimg.com/media/${filename}`;
      } else if (imgUrl.includes('/pic/')) {
        const parts = imgUrl.split('/pic/');
        imgUrl = `https://pbs.twimg.com/` + parts[1];
      }
      media.push(imgUrl);
    }

    const timestamp = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();

    tweets.push({
      id: tweetId,
      username: username,
      text: cleanText,
      created_at: pubDateStr,
      timestamp: timestamp,
      media: media
    });
  }

  return tweets;
}

// פונקציה שמנסה למשוך ציוצים ומשתמשת בשרתי גיבוי במקרה של תקלה
async function fetchUserTweets(username) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${username}/rss`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000) // הגבלת זמן ל-10 שניות לכל שרת לפני שמדלגים לשרת הבא
      });

      if (!response.ok) {
        continue; // שרת החזיר שגיאה (למשל 429 או 500), ננסה את שרת הגיבוי הבא
      }

      const xmlText = await response.text();
      if (!xmlText.includes('<rss') || !xmlText.includes('<item>')) {
        continue; // תוכן לא תקין, ננסה את שרת הגיבוי הבא
      }

      const tweets = parseNitterRss(xmlText, username);
      if (tweets.length > 0) {
        console.log(`-> Found ${tweets.length} tweets for @${username} (using ${instance.replace('https://', '')})`);
        return tweets;
      }
    } catch (err) {
      // שגיאת רשת, נמשיך שקט לשרת הבא ברשימה
    }
  }
  console.log(`-> Found 0 tweets for @${username} (all instances failed)`);
  return [];
}

(async () => {
  console.log(`Starting Twitter Scraper for ${twitterUsernames.length} users...`);
  let allTweets = [];

  for (const username of twitterUsernames) {
    console.log(`Scraping tweets for: @${username}...`);
    const tweets = await fetchUserTweets(username);
    allTweets = allTweets.concat(tweets);

    // השהייה קלה של חצי שנייה כדי לא להעמיס על שרתי ה-RSS החינמיים
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // מיון כל הציוצים שאיגדנו כך שהכי חדשים יהיו למעלה
  allTweets.sort((a, b) => b.timestamp - a.timestamp);

  // שמירה לקובץ ה-JSON
  if (allTweets.length > 0) {
    fs.writeFileSync('tweets.json', JSON.stringify(allTweets, null, 2));
    console.log(`\nFinished! Saved total of ${allTweets.length} tweets to tweets.json.`);
  } else {
    console.log("\nNo tweets were collected.");
  }
})();
