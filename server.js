const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-core');
const axios = require('axios'); // Thêm thư viện tải siêu tốc
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let browser;
let cachedCookies = []; // Lưu trữ cookie trong bộ nhớ đệm của Server
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
}

async function initBrowser() {
    browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        userDataDir: profileDir,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
    });
    console.log("Trình duyệt ảo dự phòng đã sẵn sàng!");
}
initBrowser();

// Hàm xử lý chuỗi HTML sạch
function cleanHTML(htmlStr, baseUrl) {
    // Xóa quảng cáo bằng Regex để không cần dựng DOM trên server, giúp tăng tốc tối đa
    let clean = htmlStr.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    
    // Bơm thẻ base href để load CSS chuẩn
    const baseTag = `<base href="${baseUrl}">`;
    clean = clean.replace('<head>', `<head>${baseTag}`);
    return clean;
}

const userPages = new Map();

io.on('connection', async (socket) => {
    let page;
    try {
        page = await browser.newPage();
        userPages.set(socket.id, page);
        await page.setUserAgent(USER_AGENT);
    } catch(e) {}

    // KÊNH TẢI SIÊU TỐC (HYBRID FETCH)
    socket.on('goto_url', async (url) => {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        socket.emit('status', 'Đang tải siêu tốc...');

        // Chuyển danh sách cookie thành chuỗi header gửi đi
        const cookieHeader = cachedCookies.map(c => `${c.name}=${c.value}`).join('; ');

        try {
            // Bước 1: Thử dùng Axios tải trực tiếp cực nhanh (Không qua Puppeteer)
            console.log(`[Tốc độ cao] Đang tải bằng Axios: ${url}`);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Cookie': cookieHeader
                },
                timeout: 5000 // Giới hạn đợi 5 giây
            });

            // Nếu trang web trả về không bị Cloudflare chặn
            if (response.data && !response.data.includes('cf-challenge') && !response.data.includes('cloudflare')) {
                const htmlData = cleanHTML(response.data, url);
                socket.emit('render_page', { title: "Tải nhanh", html: htmlData });
                console.log("[Thành công] Tải bằng Axios hoàn tất.");
                return;
            }
            throw new Error("Cloudflare chặn hoặc cookie hết hạn");

        } catch (err) {
            // Bước 2: Thất bại (hoặc bị chặn), tự động dùng Puppeteer để bẻ khóa lại
            console.log(`[Dự phòng] Axios thất bại (${err.message}). Chuyển sang Puppeteer...`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // Đợi load chữ thông minh
                await page.waitForFunction(() => {
                    const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
                    return el && el.textContent.trim().length > 100;
                }, { timeout: 6000 }).catch(() => {});

                // Cập nhật lại cookie mới nhất vào bộ nhớ đệm
                cachedCookies = await page.cookies();
                
                const cleanData = await page.evaluate(() => {
                    const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads'];
                    junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
                    return { title: document.title, html: document.documentElement.outerHTML };
                });

                socket.emit('render_page', cleanData);
            } catch (puppeteerErr) {
                socket.emit('status', 'Lỗi tải trang.');
            }
        }
    });

    // Kênh xử lý Click ngầm
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang click...');
        try {
            let isNavigated = false;
            const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
                .then(() => { isNavigated = true; })
                .catch(() => {});

            await page.click(selector).catch(() => {});

            await Promise.race([ navPromise, new Promise(r => setTimeout(r, 1000)) ]);

            if (!isNavigated) {
                await page.waitForFunction(() => {
                    const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
                    return el && el.textContent.trim().length > 100;
                }, { timeout: 4000 }).catch(() => {});
            }

            // Lưu lại cookie sau khi click thành công
            cachedCookies = await page.cookies();

            const cleanData = await page.evaluate(() => {
                const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads'];
                junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
                return { title: document.title, html: document.documentElement.outerHTML };
            });

            socket.emit('render_page', cleanData);
        } catch (e) {
            socket.emit('status', 'Click thất bại.');
        }
    });

    socket.on('disconnect', () => {
        const p = userPages.get(socket.id);
        if (p) p.close().catch(()=>{});
        userPages.delete(socket.id);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server Hybrid hoạt động mượt mà'));
