const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => { 
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next(); 
});

let globalBrowser = null;
const activeJobs = new Map();

async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--mute-audio', '--disable-blink-features=AutomationControlled']
        });
    }
    return globalBrowser;
}

// Endpoint xử lý tương tác từ Android
app.post('/process-action', async (req, res) => {
    const { url, cookie, userAgent, selector } = req.body;
    
    if (!url) return res.status(400).json({ error: "Thiếu URL" });

    const jobId = Math.random().toString(36).substring(7);
    const updateStatus = (msg) => { console.log(`[${jobId}] ${msg}`); activeJobs.set(jobId, msg); };

    updateStatus(`Nhận lệnh từ Android. Đang tải: ${url}`);
    let page = null;
    
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // Chặn tải tài nguyên rác cho nhanh
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        if (userAgent) await page.setUserAgent(userAgent);
        if (cookie) {
            const cookieArray = cookie.split(';').map(c => {
                const [name, ...rest] = c.split('=');
                return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(url).hostname };
            });
            await page.setCookie(...cookieArray);
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // 1. NẾU CÓ TRUYỀN SELECTOR -> THỰC HIỆN CÚ CLICK TƯƠNG TỰ NHƯ TRÊN APP
        if (selector) {
            updateStatus(`Đang click vào phần tử: ${selector}`);
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.click(selector);
                await page.waitForTimeout(1500); // Chờ JS trên web phản hồi (tải trang hoặc AJAX)
            } catch (e) {
                updateStatus(`Không tìm thấy hoặc không thể click vào: ${selector}`);
            }
        }

        // 2. VƯỢT TƯỜNG LỬA "TẢI NỘI DUNG"
        updateStatus("Kiểm tra và vượt rào chặn đọc truyện...");
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            await delay(500); 
            const btn = Array.from(document.querySelectorAll('a, button, div, span, p')).find(el => {
                const txt = el.innerText.toLowerCase();
                return txt.includes('tải nội dung') || txt.includes('click để') || txt.includes('bấm vào đây');
            });
            if (btn) btn.click();
        });

        // 3. CHỜ CHỮ XUẤT HIỆN
        updateStatus("Đang đợi trang web nhả chữ...");
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 150 && !el.textContent.includes('đang tải');
        }, { timeout: 10000 }).catch(() => updateStatus("⚠️ Hết giờ chờ, lấy dữ liệu hiện tại..."));

        // 4. LẤY MÃ HTML SẠCH
        updateStatus("Đang X-Quang copy toàn bộ HTML...");
        const fullHtml = await page.evaluate(() => {
            // Xóa các script để khi trả về app không bị chạy lại quảng cáo
            document.querySelectorAll('script, iframe').forEach(s => s.remove());
            return document.documentElement.outerHTML;
        });

        updateStatus("✅ Hoàn tất! Trả HTML về Android.");
        res.status(200).json({ html: fullHtml });

    } catch (error) {
        updateStatus(`❌ Lỗi sập nguồn: ${error.message}`);
        res.status(500).json({ error: error.message });
    } finally {
        if (page) await page.close().catch(()=>{});
        setTimeout(() => activeJobs.delete(jobId), 4000); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Máy chủ P2P Proxy hoạt động tại cổng ${PORT}`));
