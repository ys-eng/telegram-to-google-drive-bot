const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log("Starting Twitter Scraper...");
  
  // הפעלת דפדפן Chromium מובנה של GitHub
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // הגדרת User Agent של דפדפן אמיתי כדי למנוע חסימות
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // שינוי שם המשתמש כאן לשם המשתמש שברצונך לעקוב אחריו (למשל netanyahu)
  const twitterUsername = 'netanyahu'; 
  
  try {
    // מעבר לעמוד הטוויטר של המשתמש
    await page.goto(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${twitterUsername}`, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // חילוץ הנתונים מתוך ה-JSON הסמוי שטוויטר שולחת לווידג'טים שלה
    const tweetsData = await page.evaluate(() => {
      const scriptTag = document.getElementById('__NEXT_DATA__');
      if (scriptTag) {
        const jsonData = JSON.parse(scriptTag.innerText);
        // חילוץ הציוצים מתוך מבנה הנתונים של טוויטר
        const entries = jsonData.props.pageProps.timeline.instructions[0].entries || [];
        return entries.map(entry => {
          const tweet = entry.content.itemContent?.tweet_results?.result?.legacy;
          if (tweet) {
            return {
              id: entry.entryId,
              text: tweet.full_text,
              created_at: tweet.created_at,
              media: tweet.entities?.media?.map(m => m.media_url_https) || []
            };
          }
          return null;
        }).filter(t => t !== null);
      }
      return [];
    });

    if (tweetsData.length > 0) {
      console.log(`Successfully scraped ${tweetsData.length} tweets!`);
      // שמירת התוצאות לקובץ JSON
      fs.writeFileSync('tweets.json', JSON.stringify(tweetsData, null, 2));
    } else {
      console.log("No tweets found or structure changed.");
    }

  } catch (error) {
    console.error("Scraping failed:", error);
  } finally {
    await browser.close();
  }
})();
