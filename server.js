const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
// Tăng giới hạn nhận dữ liệu, dùng luôn express.json không cần body-parser
app.use(express.json({ limit: '10mb' })); 

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

let globalBrowser = null;

// TỐI ƯU 1: CHỈ KHỞI ĐỘNG CHROME 1 LẦN DUY NHẤT VÀ GIỮ NÓ SỐNG
async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        console.log("Khởi động Engine Chrome...");
        globalBrowser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: 'new', // Chế độ headless mới nhẹ hơn
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--mute-audio',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }
    return globalBrowser;
}

app.get('/', (req, res) => res.send('Trạm Đám Mây Siêu Tốc Đang Chạy ⚡'));

app.post('/get-text', async (req, res) => {
    const { url: targetUrl, cookie, userAgent } = req.body;
    
    if (!targetUrl) return res.status(400).json({ error: "Thiếu URL" });
    console.log(`Đang X-Quang: ${targetUrl}`);

    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage(); // Chỉ mở Tab mới, cực kỳ nhanh

        // TỐI ƯU 2: CẮT BỎ TÀI NGUYÊN RÁC ĐỂ LOAD WEB TRONG CHỚP MẮT
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            // Cấm tải Hình ảnh, CSS, Font, Media, Stylesheet. CHỈ CHO PHÉP Document, Script, XHR.
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Kế thừa nhân thân từ điện thoại
        if (userAgent) await page.setUserAgent(userAgent);
        if (cookie) {
            const cookieArray = cookie.split(';').map(c => {
                const [name, ...rest] = c.split('=');
                return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(targetUrl).hostname };
            });
            await page.setCookie(...cookieArray);
        }

        // Truy cập web, chỉ chờ DOM tải xong (không chờ load hình)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

        // Logic Auto-Click
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            await delay(500); // Đợi nửa giây cho mượt
            
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

        // Chờ mất chữ "đang tải", thời gian chờ tối đa 10s
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 150 && !el.textContent.includes('đang tải');
        }, { timeout: 10000 }).catch(() => console.log("TimeOut chờ chữ, vẫn lấy dữ liệu hiện tại"));

        // Rút X-Quang toàn bộ mã HTML của trang web
        const fullHtml = await page.evaluate(() => {
            // Dọn sạch script để Android không chạy lại các vòng lặp độc hại gây lag máy
            document.querySelectorAll('script, iframe').forEach(s => s.remove());
            return document.documentElement.outerHTML;
        });

        res.status(200).json({ html: fullHtml });

    } catch (error) {
        console.error("Lỗi Server:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        // TỐI ƯU 3: BẢO MẬT BỘ NHỚ - LUÔN LUÔN ĐÓNG TAB BẤT CHẤP THÀNH CÔNG HAY THẤT BẠI
        if (page) {
            await page.close().catch(e => console.error("Lỗi đóng Tab:", e.message));
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Trạm Đám Mây Siêu Tốc sẵn sàng tại cổng ${PORT}`);
});
