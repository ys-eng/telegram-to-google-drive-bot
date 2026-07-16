const fs = require('fs');

const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

(async () => {
  console.log(`Starting Twitter API Scraper for ${twitterUsernames.length} users...`);
  let allTweets = [];

  for (const username of twitterUsernames) {
    console.log(`Fetching tweets for: @${username}...`);
    try {
      // שימוש בשרת API ייעודי שעוקף את חומת ה-Login של טוויטר ומחזיר JSON ישיר
      const response = await fetch(`https://api.vxtwitter.com/${username}`);
      
      if (!response.ok) {
        console.log(`-> Server returned status ${response.status} for @${username}`);
        continue;
      }

      const data = await response.json();
      const rawTweets = data.tweets || [];

      if (rawTweets.length > 0) {
        const formattedTweets = rawTweets.map(tweet => {
          // המרת המדיה למבנה שהגוגל שיטס/צ'אט שלך מצפה לו
          const media = tweet.media_urls || [];
          
          return {
            id: tweet.id_str || String(tweet.tweetID),
            username: username,
            text: tweet.text || '',
            created_at: tweet.date || new Date().toUTCString(),
            timestamp: tweet.date_epoch ? (tweet.date_epoch * 1000) : Date.now(),
            media: media
          };
        });

        console.log(`-> Found ${formattedTweets.length} tweets for @${username}`);
        allTweets = allTweets.concat(formattedTweets);
      } else {
        console.log(`-> No recent tweets found for @${username}`);
      }

    } catch (error) {
      console.error(`Failed fetching @${username}:`, error.message);
    }

    // השהייה קלה כדי לשמור על יציבות
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // מיון - מהחדש לישן
  allTweets.sort((a, b) => b.timestamp - a.timestamp);

  // שמירה
  if (allTweets.length > 0) {
    fs.writeFileSync('tweets.json', JSON.stringify(allTweets, null, 2));
    console.log(`\nFinished! Saved total of ${allTweets.length} tweets to tweets.json.`);
  } else {
    // מניעת מצב שגוגל יקרא מערך ריק לחלוטין במקרה של תקלה כללית
    console.log("\nNo tweets were collected. Keeping old file to protect data.");
  }
})();
