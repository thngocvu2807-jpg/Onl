const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let browser;

// Đường dẫn lưu cache để tăng tốc cho các lần tải sau
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}

async function initBrowser() {
    console.log("Đang khởi động Trình duyệt ảo Tốc độ cao...");
    browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        userDataDir: profileDir, // KÍCH HOẠT CACHE TRÊN ĐĨA (TĂNG TỐC 5 LẦN)
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--memory-pressure-off'
        ]
    });
    console.log("Trình duyệt ảo đã sẵn sàng!");
}
initBrowser();

// Hàm trích xuất HTML sạch nhanh nhất
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(e){} });
        });
        
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { 
            if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; 
        });
        document.querySelectorAll('[href]').forEach(el => { 
            if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; 
        });
        
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); 
        base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

const userPages = new Map();

io.on('connection', async (socket) => {
    let page;
    try {
        page = await browser.newPage();
        userPages.set(socket.id, page);
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1024, height: 768 });
        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    } catch (err) {
        socket.emit('status', 'Lỗi khởi tạo Tab.');
        return;
    }

    // 1. TẢI URL VỚI BỘ ĐỢI THÔNG MINH
    socket.on('goto_url', async (url) => {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        socket.emit('status', 'Đang kết nối...');
        
        try {
            // Tải nhanh phần khung trang
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            // BỘ ĐỢI THÔNG MINH: Quét liên tục vào DOM, có chữ phát là gửi đi luôn, không đợi giây nào!
            await page.waitForFunction(() => {
                const el = document.querySelector('#bookcontent') || 
                           document.querySelector('#content') || 
                           document.querySelector('.contentbox') ||
                           document.querySelector('#chapter-content');
                return el && el.textContent.trim().length > 100;
            }, { timeout: 6000 }).catch(() => {}); // Đợi tối đa 6s nếu mạng lag, quá hạn vẫn nhả trang ra.

            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { 
            socket.emit('status', 'Lỗi kết nối.'); 
        }
    });

    // 2. CLICK VỚI BỘ ĐỢI THÔNG MINH
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang xử lý...');
        try {
            let isNavigated = false;
            
            const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 })
                .then(() => { isNavigated = true; })
                .catch(() => {});

            await page.click(selector).catch(() => {});

            await Promise.race([
                navPromise,
                new Promise(r => setTimeout(r, 1000))
            ]);

            // Nếu không chuyển hướng (nhấp AJAX tải chữ của Sangtacviet)
            if (!isNavigated) {
                // Đợi thông minh cho đến khi nội dung chữ thay đổi/xuất hiện
                await page.waitForFunction(() => {
                    const el = document.querySelector('#bookcontent') || 
                               document.querySelector('#content') || 
                               document.querySelector('.contentbox');
                    return el && el.textContent.trim().length > 100;
                }, { timeout: 4000 }).catch(() => {});
            }

            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { 
            socket.emit('status', 'Thao tác thất bại.'); 
        }
    });

    socket.on('disconnect', () => {
        const p = userPages.get(socket.id);
        if (p) p.close().catch(()=>{});
        userPages.delete(socket.id);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server siêu tốc hoạt động'));
