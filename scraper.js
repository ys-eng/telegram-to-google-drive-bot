const fs = require('fs');

const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

(async () => {
  console.log(`Starting Robust Twitter Scraper for ${twitterUsernames.length} users...`);
  let allTweets = [];

  for (const username of twitterUsernames) {
    console.log(`Fetching updates for: @${username}...`);
    
    // רשימת פלטפורמות חלופיות שעוקפות את החסימה בדרכים שונות
    const apiEndpoints = [
      `https://api.fxtwitter.com/${username}`,
      `https://api.fixupx.com/${username}`
    ];
    
    let userTweets = [];
    
    for (const url of apiEndpoints) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(7000)
        });

        if (response.ok) {
          const data = await response.json();
          // ה-API של fxtwitter מחזיר את הציוצים בתוך מערך בשם tweets או בתוך אובייקט המשתמש
          const rawTweets = data.tweets || (data.user && data.user.tweets) || [];
          
          if (rawTweets.length > 0) {
            userTweets = rawTweets.map(t => ({
              id: t.id_str || String(t.tweetID || t.id),
              username: username,
              text: t.text || t.description || '',
              created_at: t.date || new Date().toUTCString(),
              timestamp: t.date_epoch ? (t.date_epoch * 1000) : Date.now(),
              media: t.media_urls || (t.media && t.media.all ? t.media.all.map(m => m.url) : [])
            }));
            break; // מצאנו ציוצים, אין צורך להמשיך לכתובת הבאה עבור המשתמש הזה
          }
        }
      } catch (err) {
        // שגיאה זמנית בשרת הספציפי הזה, ננסה את הבא
      }
    }

    if (userTweets.length > 0) {
      console.log(`  -> Success! Found ${userTweets.length} tweets.`);
      allTweets = allTweets.concat(userTweets);
    } else {
      console.log(`  -> Warning: No live data retrieved for @${username}`);
    }

    // השהייה קלה בין משתמשים למניעת חסימות קצב (Rate Limiting)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // מיון - מהחדש לישן
  allTweets.sort((a, b) => b.timestamp - a.timestamp);

  // שינוי קריטי: אנחנו שומרים את הקובץ בכל מצב! 
  // גם אם רק חלק מהמשתמשים החזירו מידע, נעדכן את הקובץ כדי שגוגל יקבל את מה שיש
  if (allTweets.length > 0) {
    fs.writeFileSync('tweets.json', JSON.stringify(allTweets, null, 2));
    console.log(`\nFinished! Successfully updated tweets.json with ${allTweets.length} tweets.`);
  } else {
    console.log("\nCritical: All endpoints failed to return data. File not updated.");
  }
})();
