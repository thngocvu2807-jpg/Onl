const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
// Tăng cường bộ nạp để không từ chối gói tin của Android
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cấp phép cho Android truy cập tự do (Bỏ chặn CORS)
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

app.get('/', (req, res) => {
    let jobsHtml = '';
    if (activeJobs.size === 0) {
        jobsHtml = '<p style="color:gray;">💤 Trạm đang rảnh rỗi, chưa có yêu cầu nào...</p>';
    } else {
        activeJobs.forEach((status, id) => {
            jobsHtml += `<div style="padding:10px; margin:5px 0; border:1px solid #444; border-radius:5px; background:#222; color:#0f0;">
                            <b>Mã phiên:</b> ${id} <br>
                            <b>Trạng thái:</b> ${status}
                         </div>`;
        });
    }

    res.send(`
        <html>
            <head>
                <title>Giám Sát Trạm Đám Mây</title>
                <meta http-equiv="refresh" content="2">
                <style>body { background-color: #111; color: #fff; font-family: monospace; padding: 20px; }</style>
            </head>
            <body>
                <h2 style="color: #00ffcc;">📡 TRUNG TÂM KIỂM SOÁT P2P - CLOUD NODE</h2>
                <hr style="border-color: #333;">
                <h3>Tiến trình đang chạy:</h3>
                ${jobsHtml}
            </body>
        </html>
    `);
});

app.post('/get-text', async (req, res) => {
    // NGAY LẬP TỨC GHI NHẬN KHI CÓ NGƯỜI GỌI TỚI
    const targetUrl = req.body.url;
    
    // Nếu Android gửi lên mà mất URL -> Báo lỗi rác
    if (!targetUrl) {
        const errId = "LỖI-" + Math.floor(Math.random() * 1000);
        activeJobs.set(errId, "❌ Ai đó gửi gói tin rác (Không có URL)");
        setTimeout(() => activeJobs.delete(errId), 3000);
        return res.status(400).json({ error: "Thiếu URL" });
    }

    const jobId = Math.random().toString(36).substring(7) + " - " + new URL(targetUrl).hostname;
    const updateStatus = (msg) => {
        console.log(`[${jobId}] ${msg}`);
        activeJobs.set(jobId, msg);
    };

    updateStatus("Đã nhận lệnh từ App. Chờ khởi động Chrome...");
    let page = null;
    
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        if (req.body.userAgent) await page.setUserAgent(req.body.userAgent);
        if (req.body.cookie) {
            const cookieArray = req.body.cookie.split(';').map(c => {
                const [name, ...rest] = c.split('=');
                return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(targetUrl).hostname };
            });
            await page.setCookie(...cookieArray);
        }

        updateStatus("Đang vượt tường lửa Cloudflare & Truy cập Web...");
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

        updateStatus("Đang tìm và Click nút [Tải nội dung]...");
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            await delay(500); 
            const btn = Array.from(document.querySelectorAll('a, button, div, span, p')).find(el => {
                const txt = el.innerText.toLowerCase();
                return txt.includes('tải nội dung') || txt.includes('click để') || txt.includes('bấm vào đây');
            });
            if (btn) btn.click();
            else {
                const box = document.querySelector('#bookcontent') || document.querySelector('#content');
                if (box) box.click();
            }
        });

        updateStatus("Đang đợi trang web nhả chữ truyện...");
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 150 && !el.textContent.includes('đang tải');
        }, { timeout: 10000 }).catch(() => updateStatus("⚠️ Hết giờ chờ chữ, lấy dữ liệu hiện tại..."));

        updateStatus("Đang X-Quang copy toàn bộ HTML...");
        const fullHtml = await page.evaluate(() => {
            document.querySelectorAll('script, iframe').forEach(s => s.remove());
            return document.documentElement.outerHTML;
        });

        updateStatus("✅ Hoàn tất! Đang gửi HTML về App Android.");
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
app.listen(PORT, () => console.log(`🚀 Trạm Đám Mây Siêu Tốc sẵn sàng tại cổng ${PORT}`));
