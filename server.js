const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Cho phép mọi trang web kết nối tới
        methods: ["GET", "POST"]
    }
});
// Cấp quyền cho Express truy cập thư mục 'public' chứa file index.html
app.use(express.static('public')); 

let globalBrowser = null;

// Hàm khởi tạo và giữ duy nhất 1 trình duyệt (Tiết kiệm RAM)
async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium', // Dùng cho Render/Linux
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--mute-audio'
            ]
        });
    }
    return globalBrowser;
}

// Lắng nghe kết nối từ Web Giao diện (index.html)
io.on('connection', (socket) => {
    console.log('💻 Giao diện Web vừa kết nối: ' + socket.id);
    let page = null; // Mỗi Tab kết nối sẽ có 1 trang (page) riêng biệt

    // ----------------------------------------------------
    // 1. KHI NGƯỜI DÙNG NHẬP URL VÀ BẤM NÚT "CHẠY"
    // ----------------------------------------------------
    socket.on('goto_url', async (url) => {
        try {
            socket.emit('status', 'Khởi động máy chủ ảo...');
            const browser = await getBrowser();
            
            // Nếu có trang cũ đang mở, đóng lại cho nhẹ RAM
            if (page && !page.isClosed()) {
                await page.close().catch(()=>{});
            }
            
            page = await browser.newPage();
            
            // CHẶN TÀI NGUYÊN RÁC (Tăng tốc độ tải x3 lần)
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            socket.emit('status', 'Đang truy cập trang web...');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // TỰ ĐỘNG BẤM NÚT "TẢI NỘI DUNG" NẾU CÓ BỊ CHẶN
            socket.emit('status', 'Kiểm tra rào cản nội dung...');
            await page.evaluate(async () => {
                await new Promise(res => setTimeout(res, 500)); // Đợi 0.5s cho web nhả DOM
                const btns = Array.from(document.querySelectorAll('a, button, div, span, p'));
                const btn = btns.find(el => {
                    const txt = el.innerText ? el.innerText.toLowerCase() : '';
                    return txt.includes('tải nội dung') || txt.includes('click để') || txt.includes('bấm vào đây');
                });
                if (btn) btn.click();
            });

            socket.emit('status', 'Đang tải dữ liệu, vui lòng chờ...');
            await page.waitForTimeout(2000); // Đợi js trên web gốc render chữ xong
            
            // XÓA SCRIPT ĐỂ KHÔNG BỊ LOAD LẠI QUẢNG CÁO RỒI LẤY HTML
            socket.emit('status', 'Đang kết xuất HTML...');
            const html = await page.evaluate(() => {
                document.querySelectorAll('script, iframe').forEach(s => s.remove());
                return document.documentElement.outerHTML;
            });
            const title = await page.title();
            const currentUrl = await page.url();

            // Gửi dữ liệu về lại cho index.html hiển thị
            socket.emit('render_page', { html, title, url: currentUrl });

        } catch (e) {
            console.error("Lỗi goto_url:", e.message);
            socket.emit('status', 'Lỗi tải trang: ' + e.message);
        }
    });

    // ----------------------------------------------------
    // 2. KHI NGƯỜI DÙNG CLICK VÀO NÚT BÊN TRONG IFRAME
    // ----------------------------------------------------
    socket.on('user_click', async (selector) => {
        if (!page || page.isClosed()) {
            return socket.emit('status', 'Lỗi: Máy chủ đã mất dấu trang web!');
        }

        try {
            socket.emit('status', 'Mô phỏng thao tác Click...');
            await page.waitForSelector(selector, { timeout: 5000 });
            await page.click(selector);
            
            socket.emit('status', 'Đang chờ trang web phản hồi...');
            await page.waitForTimeout(2000); // Chờ 2s để web gốc chuyển chương/trang

            // Cào lại HTML mới sau khi click
            const html = await page.evaluate(() => {
                document.querySelectorAll('script, iframe').forEach(s => s.remove());
                return document.documentElement.outerHTML;
            });
            const title = await page.title();
            const currentUrl = await page.url();

            // Gửi về giao diện
            socket.emit('render_page', { html, title, url: currentUrl });

        } catch (e) {
            console.error("Lỗi user_click:", e.message);
            socket.emit('status', 'Click thất bại: Có thể web không phản hồi hoặc sai cấu trúc.');
        }
    });

    // ----------------------------------------------------
    // 3. KHI NGƯỜI DÙNG TẮT TRÌNH DUYỆT (GIẢI PHÓNG RAM)
    // ----------------------------------------------------
    socket.on('disconnect', async () => {
        console.log('❌ Ngắt kết nối: ' + socket.id);
        if (page && !page.isClosed()) {
            await page.close().catch(()=>{});
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Trình duyệt Đám mây khởi chạy tại cổng ${PORT}`));
