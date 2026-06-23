const express = require('express');
const http = require('http');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

let browser;
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Khởi chạy Chrome ảo tích hợp Auto-Click...");
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

app.get('/', (req, res) => res.send('<h2 style="color:green;text-align:center;">Trạm Auto-Click Đang Chạy 🟢</h2>'));

app.get('/get-text', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Thiếu URL" });
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    console.log(`Đang bẻ khóa & Auto-Click: ${targetUrl}`);
    let page;
    try {
        const b = await getBrowser();
        page = await b.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // ========================================================
        // AI AUTO-CLICKER: TỰ ĐỘNG TÌM NÚT VÀ BẤM THAY NGƯỜI DÙNG
        // ========================================================
        await page.evaluate(() => {
            // 1. Tìm các nút có chữ "tải nội dung", "click", "bấm vào đây"
            const elements = Array.from(document.querySelectorAll('a, button, div, span, p'));
            const loadBtn = elements.find(el => {
                const text = el.innerText.toLowerCase();
                return text.includes('tải nội dung') || 
                       text.includes('click để') || 
                       text.includes('bấm vào đây') || 
                       text.includes('nhấn vào đây');
            });
            
            if (loadBtn) {
                loadBtn.click(); // Bấm thẳng vào nút
            } else {
                // 2. Nếu không có nút rõ ràng, giả lập bấm vào khung nội dung (Sangtacviet hay dùng trò này)
                const box = document.querySelector('#bookcontent') || document.querySelector('#content');
                if (box) box.click();
            }
        });

        // ========================================================
        // CHỜ KẾT QUẢ SAU KHI BẤM (Cho nó 12 giây để tải)
        // ========================================================
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            // Điều kiện: Dài hơn 150 ký tự và KHÔNG chứa chữ "đang tải"
            return el && el.textContent.trim().length > 150 && !el.textContent.includes('đang tải');
        }, { timeout: 12000 }).catch(() => console.log("Hết hạn chờ chữ (Có thể web đang lag)"));

        // Rút trích HTML siêu sạch
        const decryptedHtml = await page.evaluate(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            if (!el) return '';
            el.querySelectorAll('script, iframe, ins, .ads, #ads').forEach(e => e.remove());
            return el.innerHTML; // Trả về dạng HTML để giữ nguyên xuống dòng, in đậm...
        });

        await page.close();

        // Gửi về cho Android
        res.status(200).json({ html: decryptedHtml });
    } catch (e) {
        if (page) await page.close().catch(() => {});
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Trạm chạy ở cổng ${PORT}`));
