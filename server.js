const express = require('express');
const http = require('http');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// CORS cho phép Android gọi thoải mái
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

let browser;
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Khởi chạy Chrome ảo...");
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            userDataDir: profileDir,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--single-process', '--memory-pressure-off'
            ]
        });
    }
    return browser;
}

app.get('/', (req, res) => {
    res.send('<h2 style="color:green;text-align:center;margin-top:50px;">Trạm Đám Mây Hoạt Động Bình Thường 🟢</h2>');
});

// API chính để lấy nội dung thô
app.get('/get-text', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Thiếu URL" });
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    console.log(`Đang xử lý: ${targetUrl}`);
    let page;
    try {
        const b = await getBrowser();
        page = await b.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Chờ đúng vùng chữ xuất hiện
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 100;
        }, { timeout: 10000 }).catch(() => {});

        // Lấy đúng khung HTML chữ
        const decryptedHtml = await page.evaluate(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            if (!el) return '';
            // Xóa rác
            el.querySelectorAll('script, iframe, ins, .ads, #ads').forEach(e => e.remove());
            return el.innerHTML;
        });

        await page.close();

        // Luôn trả về 200 OK cho Android
        res.status(200).json({ html: decryptedHtml });
    } catch (e) {
        if (page) await page.close().catch(() => {});
        console.error("Lỗi:", e.message);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Trạm chạy ở cổng ${PORT}`));
