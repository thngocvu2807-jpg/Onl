const express = require('express');
const http = require('http');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

app.use(bodyParser.json({ limit: '50mb' })); // Tăng limit vì cả trang web HTML khá nặng
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

let browser;
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            userDataDir: profileDir,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        });
    }
    return browser;
}

app.post('/get-text', async (req, res) => {
    let { url: targetUrl, cookie, userAgent } = req.body;
    if (!targetUrl) return res.status(400).json({ error: "Thiếu URL" });
    
    let page;
    try {
        const b = await getBrowser();
        page = await b.newPage();
        
        // Gắn nhân thân (User Agent & Cookie) từ Android sang máy chủ
        if(userAgent) await page.setUserAgent(userAgent);
        if (cookie) {
            const cookieArray = cookie.split(';').map(c => {
                const [name, ...rest] = c.split('=');
                return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(targetUrl).hostname };
            });
            await page.setCookie(...cookieArray);
        }

        // Truy cập web
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

        // MÁY CHỦ BẤM NÚT TẢI NỘI DUNG (Đóng vai trò điều khiển)
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            await delay(1000); 
            
            // Tìm và click nút tải nội dung bị chặn
            const btn = Array.from(document.querySelectorAll('a, button, div, span, p')).find(el => {
                const txt = el.innerText.toLowerCase();
                return txt.includes('tải nội dung') || txt.includes('bấm vào đây');
            });
            if (btn) btn.click();
        });

        // Đợi đến khi nội dung truyện bung ra (mất chữ "đang tải")
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content');
            return el && el.textContent.trim().length > 200 && !el.textContent.includes('đang tải');
        }, { timeout: 15000 }).catch(() => {}); // Kể cả timeout cũng không sao, lấy những gì đang có

        // ĐÂY LÀ ĐIỂM KHÁC BIỆT: LẤY TOÀN BỘ CẢ TRANG WEB (X-QUANG)
        const fullHtml = await page.evaluate(() => {
            // Xóa bớt script để khi ném về Android không bị load lại các lệnh lỗi của Sangtacviet
            document.querySelectorAll('script').forEach(s => s.remove());
            return document.documentElement.outerHTML; // Trả về <html>...toàn bộ...</html>
        });

        await page.close();
        res.status(200).json({ html: fullHtml });
    } catch (e) {
        if (page) await page.close().catch(() => {});
        res.status(500).json({ error: e.message });
    }
});

server.listen(process.env.PORT || 3000);
