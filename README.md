# telegram-to-google-drive-bot
# Telegram to Google Drive Automation Bot 🚀

A lightweight, automated integration built with Google Apps Script (GAS) that fetches updates from Telegram channels via RSS and securely backs up or processes the content into Google Drive.

## 📌 Features
* **Automated Syncing:** Periodically monitors targeted Telegram channels.
* **RSS-to-Cloud Integration:** Utilizes JSON/RSS feeds to pull channel updates dynamically without hitting rate limits.
* **Google Drive Uploads:** Automatically parses messages and media, saving them directly to structured Google Drive folders.
* **Error Handling & Logs:** Built-in execution logging within Google Apps Script for easy debugging.

---

## 🛠️ Tech Stack
* **Language:** JavaScript (ES6+)
* **Platform:** Google Apps Script (GAS)
* **API Integrations:** Telegram RSS/JSON Feed API, Google Drive API

---

## ⚙️ How It Works
1. **Fetch:** The script runs on a time-driven trigger (e.g., every 15 minutes) and fetches JSON data from the configured Telegram RSS endpoints.
2. **Filter:** It checks for new posts by comparing the post timestamp with the last execution time.
3. **Upload:** For every new post, it formats the content and writes/uploads it directly to your designated Google Drive folder.

---

## 🚀 Getting Started

### Prerequisites
* A Google Account (for Google Apps Script and Google Drive).
* Public Telegram channels you wish to monitor.

### Installation & Setup
1. **Clone the script:** Copy the code from `Code.js` in this repository.
2. **Create a Google Apps Script Project:**
   * Go to [script.google.com](https://script.google.com/).
   * Create a new project and paste the code inside the editor.
3. **Configure Variables:**
   * Replace the placeholder RSS/Telegram URLs in the script with your own.
   * Define your target Google Drive Folder ID.
4. **Set up Triggers:**
   * Click on the **Triggers** icon (the clock icon) on the left sidebar.
   * Add a new trigger to run your main function (e.g., `fetchUpdates`) on a "Time-driven" basis (every 10-15 minutes).

---

## 📝 License
This project is licensed under the MIT License - see the LICENSE file for details.
