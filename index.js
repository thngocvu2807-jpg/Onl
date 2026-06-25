const express = require('express');
const puppeteer = require('puppeteer');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG (RENDER ENVIRONMENT VARIABLES)
const SHARE_CODE = process.env.SHARE_CODE || 'BOT-VIP-9999'; // Mã mời của Bot
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; // Bắt buộc phải nhập trên Render
const START_URL = process.env.START_URL || ''; // Link chương đầu tiên bot bắt đầu cày

app.get('/', (req, res) => {
    res.send(`🤖 Nông trại Dịch thuật Đang Chạy. Mã mời của Bot là: <b>${SHARE_CODE}</b>`);
});

app.listen(PORT, () => {
    console.log(`Server khởi chạy tại port ${PORT}`);
    startAntiSleep();
    if (START_URL && GEMINI_API_KEY) {
        startFarmBot();
    } else {
        console.log("⚠️ CHỜ CẤU HÌNH: Hãy thêm START_URL và GEMINI_API_KEY vào Environment Variables trên Render.");
    }
});

// Giữ server sống 24/24
function startAntiSleep() {
    const MY_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}.onrender.com`;
    setInterval(() => {
        if (process.env.RENDER_EXTERNAL_HOSTNAME) {
            https.get(MY_URL).on('error', () => {});
        }
    }, 10 * 60 * 1000);
}

// =========================================================================
// HỆ THỐNG BOT CÀY CUỐC 24/24
// =========================================================================
async function startFarmBot() {
    console.log(`🚀 BOT KHỞI ĐỘNG! Bắt đầu cày từ: ${START_URL}`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Truyền biến môi trường vào môi trường trình duyệt ảo
    await page.evaluateOnNewDocument(`
        window.BOT_SHARE_CODE = "${SHARE_CODE}";
        window.GEMINI_API_KEY = "${GEMINI_API_KEY}";
    `);

    // Tiêm siêu thuật toán Mã hóa và Phát sóng Nostr y hệt App Android của bạn vào Bot
    await page.evaluateOnNewDocument(`
        window.BOT_CRYPTO = {
            bufferToBase64(buffer) {
                let binary = '';
                const bytes = new Uint8Array(buffer);
                for (let i = 0; i < bytes.byteLength; i += 0x8000) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                return btoa(binary);
            },
            async hashSHA256(text) {
                const bytes = new TextEncoder().encode(text.trim());
                const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            },
            async deriveSecretKey(secretString, textHash) {
                const encoder = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secretString), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(textHash));
                return await crypto.subtle.importKey('raw', signature.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
            },
            async encryptAndCompress(plainText, secretString, textHash) {
                try {
                    const bytes = new TextEncoder().encode(plainText);
                    const cs = new CompressionStream('gzip');
                    const writer = cs.writable.getWriter();
                    writer.write(bytes); writer.close();
                    const res = new Response(cs.readable);
                    const compressedBytes = new Uint8Array(await res.arrayBuffer());

                    const secretKey = await this.deriveSecretKey(secretString, textHash);
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, secretKey, compressedBytes);
                    
                    const encryptedBytes = new Uint8Array(encryptedBuffer);
                    const combined = new Uint8Array(iv.length + encryptedBytes.length);
                    combined.set(iv); combined.set(encryptedBytes, iv.length);
                    return this.bufferToBase64(combined);
                } catch (err) { return null; }
            }
        };

        window.publishToNostr = async (tagD, contentData) => {
            return new Promise(async (resolve) => {
                try {
                    // Tải thư viện Nostr
                    if (!window.NostrTools) {
                        await new Promise(r => {
                            const s = document.createElement('script');
                            s.src = "https://unpkg.com/nostr-tools@1.17.0/lib/nostr.bundle.js";
                            s.onload = r; document.head.appendChild(s);
                        });
                    }
                    
                    const tools = window.NostrTools;
                    const privateKeyHex = await window.BOT_CRYPTO.hashSHA256(window.BOT_SHARE_CODE);
                    
                    // Xử lý khóa công khai
                    let pubKeyHex;
                    try { pubKeyHex = tools.getPublicKey(privateKeyHex); } 
                    catch(e) { 
                        const hexToBytes = (h) => new Uint8Array(h.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                        pubKeyHex = tools.getPublicKey(hexToBytes(privateKeyHex)); 
                    }

                    const encryptedPayload = await window.BOT_CRYPTO.encryptAndCompress(JSON.stringify(contentData), window.BOT_SHARE_CODE, tagD);
                    if (!encryptedPayload) return resolve(false);

                    let event = {
                        kind: 30002, pubkey: pubKeyHex, created_at: Math.floor(Date.now() / 1000),
                        tags: [["d", tagD], ["t", "vip_hub_p2p"]], content: encryptedPayload
                    };

                    if (typeof tools.finalizeEvent === 'function') {
                        const hexToBytes = (h) => new Uint8Array(h.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                        event = tools.finalizeEvent(event, hexToBytes(privateKeyHex));
                    } else {
                        event.id = tools.getEventHash(event);
                        event.sig = tools.getSignature(event, privateKeyHex);
                    }

                    const ws = new WebSocket('wss://relay.damus.io');
                    ws.onopen = () => { ws.send(JSON.stringify(["EVENT", event])); setTimeout(() => { ws.close(); resolve(true); }, 2000); };
                    ws.onerror = () => resolve(false);
                } catch (e) { resolve(false); }
            });
        };
        
        window.callGeminiAPI = async (prompt) => {
            const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=\${window.GEMINI_API_KEY}\`;
            try {
                const res = await fetch(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                return data.candidates[0].content.parts[0].text;
            } catch(e) { return null; }
        };
    `);

    let currentUrl = START_URL;

    // VÒNG LẶP CÀY CUỐC VĨNH CỬU
    while (currentUrl) {
        console.log(`\n⏳ Đang cày chương: ${currentUrl}`);
        try {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Ép Bot tự động thực thi quá trình trích xuất, dịch và đẩy lên Nostr
            const result = await page.evaluate(async () => {
                // 1. Trích xuất Text
                const contentContainer = document.querySelector('article, main, .read-content, .chapter-content, #chapterContent, .text-wrap') || document.body;
                const rawText = contentContainer.innerText.substring(0, 4000); // Lấy 4000 chữ đầu
                
                let title = document.title;
                const titleEl = document.querySelector('h1, .chapter-title, .title');
                if (titleEl) title = titleEl.innerText;

                if (!rawText || rawText.trim().length < 50) return { error: "Không tìm thấy nội dung truyện" };

                // 2. Dịch bằng Gemini
                const prompt = `Dịch toàn bộ văn bản sau sang Tiếng Việt chuẩn xác, mượt mà. Giữ nguyên định dạng đoạn văn.\n\n[NỘI DUNG]:\n${rawText}`;
                const translatedText = await window.callGeminiAPI(prompt);
                
                if (!translatedText) return { error: "Lỗi gọi API Gemini" };

                // 3. Xây dựng Hash chuẩn hệ sinh thái của App Android
                const getUrlHash = (url) => {
                    let u = url.split('?')[0].split('#')[0]; if (u.endsWith('/')) u = u.slice(0, -1);
                    const encoded = encodeURIComponent(u).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1));
                    return btoa(encoded).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_').substring(0, 100);
                };
                
                const getSmartNovelId = (urlStr) => {
                    try {
                        let url = new URL(urlStr);
                        let domain = url.hostname.replace(/^(www|m|h5|wap)\\./i, '');
                        let cleanPath = url.pathname.replace(/\\.[a-zA-Z0-9]+$/g, '');
                        let numMatches = cleanPath.match(/\\b\\d{4,}\\b/g);
                        if (numMatches && numMatches.length > 0) return "DOC_" + domain.replace(/\\./g, '_') + "_" + numMatches[0];
                    } catch(e) {}
                    return "DOC_UNKNOWN";
                };

                const cidHash = getUrlHash(window.location.href);
                const nidSmart = getSmartNovelId(window.location.href);
                const smartHash = nidSmart + '_' + cidHash;

                // 4. Phát sóng lên P2P (Bản Dịch DOM + Global Chapter)
                const keyUrlHash = await window.BOT_CRYPTO.hashSHA256(cidHash + "_dom_mapping");
                const keySmartHash = await window.BOT_CRYPTO.hashSHA256(smartHash + "_dom_mapping");
                
                // Giả lập từ điển Local Dict để app bên kia ốp vào
                const fakeLocalDict = { "auto_gen_hash": translatedText }; // Trong thực tế, bot nên chia span hash, nhưng để app hiển thị được ngay, bot gửi luôn nội dung text
                
                const syncPayload = { mapping: fakeLocalDict, text: translatedText, time: Date.now() };
                
                await window.publishToNostr(keyUrlHash, syncPayload);
                await window.publishToNostr(keySmartHash, syncPayload);

                // Publish Global Chapter (Nhật ký chương)
                const chapPayload = { chapters: [{ id: cidHash, n: "Tài liệu Bot", c: title, u: window.location.href, t: Date.now(), a: "Bot Render", summary: translatedText.substring(0, 300) }], time: Date.now() };
                const keyChapters = await window.BOT_CRYPTO.hashSHA256("P2P_CHAPTERS_" + window.BOT_SHARE_CODE);
                await window.publishToNostr(keyChapters, chapPayload);

                // 5. TÌM LINK CHƯƠNG TIẾP THEO
                let nextUrl = null;
                const links = document.querySelectorAll('a');
                for (let a of links) {
                    let text = a.innerText.toLowerCase();
                    if (text.includes('next') || text.includes('tiếp') || text.includes('sau') || text.includes('下一章')) {
                        nextUrl = a.href; break;
                    }
                }

                return { success: true, nextUrl: nextUrl, title: title };
            });

            if (result.error) {
                console.log("❌ Lỗi Bot: " + result.error);
                break; // Dừng nếu web bị lỗi/hết truyện
            }

            console.log(`✅ Đã dịch và phát sóng thành công: ${result.title}`);
            
            // Chuyển sang chương tiếp theo
            if (result.nextUrl && result.nextUrl.startsWith('http')) {
                currentUrl = result.nextUrl;
                // Tạm nghỉ 10 giây để tránh bị Web block và Gemini báo lỗi Rate Limit
                console.log("💤 Đang nghỉ 10 giây trước khi cày chương tiếp theo...");
                await new Promise(r => setTimeout(r, 10000));
            } else {
                console.log("🎉 ĐÃ HẾT TRUYỆN! Bot tiến vào trạng thái ngủ.");
                currentUrl = null;
            }

        } catch (error) {
            console.error("Lỗi sụp đổ trang, thử lại sau 30s...", error.message);
            await new Promise(r => setTimeout(r, 30000));
            // Không set currentUrl = null để nó thử lại trang bị lỗi
        }
    }
}
