const express = require('express');
const http = require('http');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Cấu hình CORS để cho phép ứng dụng Android gọi API tự do
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

let browser;
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Khởi chạy Chrome ảo chống chặn...");
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            userDataDir: profileDir, // Lưu bộ nhớ đệm cookies/cache
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });
    }
    return browser;
}

// Hàm làm sạch cấu trúc HTML nhận về
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(e){} });
        });
        const el = document.querySelector('#bookcontent') || 
                   document.querySelector('#content') || 
                   document.querySelector('.contentbox') ||
                   document.querySelector('#chapter-content');
        return el ? el.innerHTML : '';
    });
}

// API endpoint để App Android gọi lấy nội dung trực tiếp
app.get('/get-text', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: "Missing url parameter" });
    }
    if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
    }

    console.log(`Đang xử lý yêu cầu bẻ khóa: ${targetUrl}`);
    let page;
    try {
        const b = await getBrowser();
        page = await b.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1024, height: 768 });
        
        // Tránh cơ chế phát hiện Bot
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Bộ đợi thông minh: có chữ phát nhả dữ liệu ngay
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || 
                       document.querySelector('#content') || 
                       document.querySelector('.contentbox') ||
                       document.querySelector('#chapter-content');
            return el && el.textContent.trim().length > 100;
        }, { timeout: 8000 }).catch(() => {});

        const decryptedHtml = await extractCleanHTML(page);
        await page.close();

        res.json({ html: decryptedHtml });
    } catch (e) {
        if (page) await page.close().catch(() => {});
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Trạm máy chủ bẻ khóa hoạt động tại cổng ${PORT}`);
});
