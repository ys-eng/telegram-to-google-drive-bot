function sendMerkazToChat() {
  try {
    // 1. הכתובות של ערוץ מרכז והצ'אט שלך
    var rssUrl = ;
    var chatWebhookUrl =; 
    
    var response = UrlFetchApp.fetch(rssUrl, {"muteHttpExceptions": true});
    if (response.getResponseCode() !== 200) {
      Logger.log("השרת ב-Render לא זמין כרגע. ננסה שוב אחר כך.");
      return;
    }
    
    var data = JSON.parse(response.getContentText());
    var items = data.items;
    
    var props = PropertiesService.getScriptProperties();
    var lastDate = props.getProperty("lastDate_merkaz");
    
    if (!lastDate) { 
      props.setProperty("lastDate_merkaz", new Date().getTime().toString());
      Logger.log("הפעלה ראשונה לערוץ מרכז: התאריך נשמר.");
      return; 
    } else { 
      lastDate = parseInt(lastDate); 
    }
    
    var newestDate = lastDate;
    var newItems = [];
    
    for (var i = 0; i < items.length; i++) {
      var itemDate = new Date(items[i].date_published).getTime();
      if (itemDate > lastDate) {
        newItems.push(items[i]);
      }
    }
    
    newItems.reverse();
    
    // ——— מציאת/יצירת תיקיית הוידאו, עם שמירת ה-ID ב-Properties כדי לשמור על יעילות ———
    var folderName = "Telegram_Videos";
    var folder;
    var folderId = props.getProperty("merkazVideoFolderId");
    
    if (folderId) {
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (folderErr) {
        folder = null; // אם התיקייה נמחקה או הועברה, נאתר אותה מחדש
      }
    }
    
    if (!folder) {
      var folders = DriveApp.getFoldersByName(folderName);
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder(folderName);
      }
      props.setProperty("merkazVideoFolderId", folder.getId());
    }
    
    var confirmedDate = lastDate;
    
    for (var j = 0; j < newItems.length; j++) {
      var itemSucceeded = false;
      
      try {
        var item = newItems[j];
        var embedHtml = item.content_html || "";
        
        // ניקוי הטקסט מתגיות HTML
        var cleanText = embedHtml.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim();
        var finalMessage = cleanText;
        
// ——— מנגנון חילוץ והעלאת מדיה (וידאו/תמונה) לגוגל דרייב ———
        var mediaLink = "";
        // ה-Regex החדש שמחפש גם וידאו (mp4) וגם תמונות (jpg, jpeg, png)
        var mediaSrcRegex = /(https:\/\/cdn\d*\.telesco\.pe\/file\/[^"']+\.(?:mp4|jpg|jpeg|png)[^"']*)/;
        var mediaMatch = mediaSrcRegex.exec(embedHtml);
        
        if (mediaMatch) {
          try {
            var mediaUrl = mediaMatch[1];
            var mediaRes = UrlFetchApp.fetch(mediaUrl, { muteHttpExceptions: true });
            
            if (mediaRes.getResponseCode() === 200 || mediaRes.getResponseCode() === 206) {
              var timestamp = new Date().getTime();
              
              // חילוץ אוטומטי של סיומת הקובץ המקורית (כדי שתמונה תישאר תמונה ווידאו יישאר וידאו)
              var extMatch = mediaUrl.match(/\.(mp4|jpg|jpeg|png)/i);
              var fileExtension = extMatch ? extMatch[1].toLowerCase() : "bin";
              
              var driveFile = folder.createFile(mediaRes.getBlob().setName("media_" + timestamp + "." + fileExtension));
              driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
              mediaLink = driveFile.getUrl();
            } else {
              Logger.log("הורדת המדיה נכשלה (קוד: " + mediaRes.getResponseCode() + "). הפוסט יישלח ללא מדיה.");
            }
          } catch (mediaError) {
            Logger.log("שגיאה בהורדת/העלאת המדיה: " + mediaError.toString());
          }
        }
        
        // הצמדת הקישור להודעה במידה והקובץ הועלה בהצלחה לדרייב
        if (mediaLink !== "") {
          if (finalMessage !== "") {
            finalMessage += "\n\n📎 לצפייה במדיה המצורפת בדרייב:\n" + mediaLink;
          } else {
            finalMessage = "📎 נשלח קובץ מדיה חדש בדרייב:\n" + mediaLink;
          }
        }
        
        // שליחת ההודעה הסופית לגוגל צ'אט
        var chatRes = UrlFetchApp.fetch(chatWebhookUrl, {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify({ "text": finalMessage }),
          "muteHttpExceptions": true
        });
        
        var chatCode = chatRes.getResponseCode();
        if (chatCode >= 200 && chatCode < 300) {
          itemSucceeded = true;
        } else {
          Logger.log("שליחת ההודעה לצ'אט נכשלה לפריט " + j + ", קוד תגובה: " + chatCode);
        }
        
        Utilities.sleep(1500);
        
      } catch (itemError) {
        Logger.log("שגיאה חריגה בטיפול בפריט מספר " + j + ": " + itemError.toString());
      }
      
      if (itemSucceeded) {
        confirmedDate = new Date(item.date_published).getTime();
      } else {
        // עצירה מבוקרת - אם גוגל צ'אט נכשל, ננסה שוב מהפוסט הזה בריצה הבאה
        break; 
      }
    }
    
    if (confirmedDate !== lastDate) {
      props.setProperty("lastDate_merkaz", confirmedDate.toString());
    }
    
    Logger.log("הריצה של ערוץ מרכז הסתיימה בהצלחה.");
  } catch(e) {
    Logger.log("שגיאה כללית בריצה: " + e.toString());
  }
}
