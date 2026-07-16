const puppeteer = require('puppeteer');
const fs = require('fs');

// רשימת החשבונות שביקשת לעקוב אחריהם
const twitterUsernames = [
  'yoelituv', 'avi__blum', 'arivlin1', 'AryeErlich', 'moshe_nayes', 
  'Israelcohen911', 'ishaycoen', 'yankihebrew', 'yossilevii', 'YakiAdamker', 
  'YinonMagal', 'amit_segal', 'AviMoskov', 'avrahamFriend', 'BismuthBoaz', 
  'CohenBezalel02', 'BombachMenachem', 'YitzikCrombie', 'AvreymiYus', 
  'KemachIsrael', 'Machon_Haredi', 'yehuditmiletzky', 'mk_moshe_gafni'
];

(async () => {
  console.log(`Starting Twitter Scraper for ${twitterUsernames.length} users...`);
  
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
});  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let allTweets = [];

  // לולאה שעוברת משתמש-משתמש ושואבת את הציוצים שלו
  for (const username of twitterUsernames) {
    console.log(`Scraping tweets for: @${username}...`);
    try {
      await page.goto(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      const tweetsData = await page.evaluate((user) => {
        const scriptTag = document.getElementById('__NEXT_DATA__');
        if (scriptTag) {
          try {
            const jsonData = JSON.parse(scriptTag.innerText);
            const entries = jsonData.props.pageProps.timeline.instructions[0].entries || [];
            return entries.map(entry => {
              const tweet = entry.content.itemContent?.tweet_results?.result?.legacy;
              if (tweet) {
                return {
                  id: entry.entryId,
                  username: user,
                  text: tweet.full_text,
                  created_at: tweet.created_at,
                  timestamp: new Date(tweet.created_at).getTime(),
                  media: tweet.entities?.media?.map(m => m.media_url_https) || []
                };
              }
              return null;
            }).filter(t => t !== null);
          } catch (e) {
            return [];
          }
        }
        return [];
      }, username);

      console.log(`-> Found ${tweetsData.length} tweets for @${username}`);
      allTweets = allTweets.concat(tweetsData);

      // השהייה קלה של שנייה בין משתמש למשתמש כדי להישאר "מתחת לרדאר" של טוויטר
      await new Promise(resolve => setTimeout(resolve, 1500));

    } catch (error) {
      console.error(`Failed scraping @${username}:`, error.message);
    }
  }

  // מיון כל הציוצים שאיגדנו כך שהכי חדשים יהיו למעלה
  allTweets.sort((a, b) => b.timestamp - a.timestamp);

  // שמירה לקובץ ה-JSON
  if (allTweets.length > 0) {
    fs.writeFileSync('tweets.json', JSON.stringify(allTweets, null, 2));
    console.log(`Finished! Saved total of ${allTweets.length} tweets to tweets.json.`);
  } else {
    console.log("No tweets were collected.");
  }

  await browser.close();
})();
