const { connect } = require("puppeteer-real-browser");

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("正在通过 puppeteer-real-browser 启动浏览器...");
    const { browser, page } = await connect({
        args: [
            "--proxy-server=socks5://127.0.0.1:10808",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--ignore-certificate-errors",
            "--allow-running-insecure-content",
            "--disable-web-security"
        ],
        turnstile: true,
        headless: false,
        connectOption: { defaultViewport: { width: 1920, height: 1080 } }
    });

    try {
        await page.setDefaultNavigationTimeout(60000);
        await page.setViewport({ width: 1920, height: 1080 });

        // 1. 登录流程
        console.log("正在打开登录页面...");
        await page.goto("https://client.falixnodes.net/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
        await delay(8000); 

        console.log("正在输入登录凭证...");
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', process.env.FALIX_EMAIL);

        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', process.env.FALIX_PASSWORD);

        await delay(2000);
        console.log("正在点击登录按钮...");
        
        const loginBtn = await page.$('button[type="submit"]') || await page.$('button');
        if (loginBtn) {
            await page.evaluate(el => el.click(), loginBtn);
        } else {
            throw new Error("未找到登录按钮");
        }

        console.log("等待登录跳转中...");
        await delay(12000);

        // 2. 控制台流程
        const consoleUrl = "https://client.falixnodes.net/server/2845100/console";
        console.log(`正在跳转至控制台页面: ${consoleUrl}`);
        await page.goto(consoleUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await delay(10000); // 留出充足时间让建立 WebSocket 握手

        // 循环检测与开机（最多尝试 3 次）
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`\n--- 开始执行第 ${attempt}/3 次状态检测与开机尝试 ---`);
            
            if (attempt > 1) {
                await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
                await delay(8000);
            }

            // A. 检测并应对“连接丢失”弹窗
            const hasConnectionLost = await page.evaluate(() => {
                const text = document.body.innerText;
                return text.includes("Connection lost") || text.includes("连接已断开");
            });

            if (hasConnectionLost) {
                console.log("[警告] 检测到 WebSocket 连接丢失，尝试等待 6 秒重建连接...");
                await delay(6000);
                // 再次检查
                const stillLost = await page.evaluate(() => {
                    const text = document.body.innerText;
                    return text.includes("Connection lost") || text.includes("连接已断开");
                });
                if (stillLost) {
                    console.log("[警告] 仍未连接成功，强制刷新控制台页面...");
                    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
                    await delay(10000);
                }
            }

            // B. 检查服务器状态
            const pageContent = await page.content();
            const isOffline = pageContent.toLowerCase().includes("offline") || pageContent.includes("离线");

            if (!isOffline) {
                console.log("服务器当前不处于 Offline 状态。流程结束。");
                break;
            }

            console.log("服务器状态确认：Offline。开始准备开机步骤...");

            // C. 动态等待启动按钮“可用/被激活”（非灰色状态）
            console.log("正在等待启动按钮激活转绿...");
            let isButtonReady = false;
            let startButtonHandle = null;

            // 循环检测 10 次，每次间隔 2 秒，最多等 20 秒
            for (let check = 1; check <= 10; check++) {
                startButtonHandle = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.textContent.includes('启动') || b.textContent.includes('Start'));
                    if (!btn) return null;
                    
                    const isDisabledAttr = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
                    const hasDisabledClass = btn.classList.contains('disabled') || btn.className.includes('disabled');
                    
                    if (isDisabledAttr || hasDisabledClass) {
                        return null; 
                    }
                    return btn; 
                });

                if (startButtonHandle && startButtonHandle.asElement()) {
                    isButtonReady = true;
                    console.log(`[成功] 启动按钮已于第 ${check * 2} 秒成功激活！`);
                    break;
                }
                
                await delay(2000);
            }

            if (!isButtonReady) {
                console.log("[提示] 启动按钮在 20 秒内未能激活（可能网络连接延迟高），我们将尝试强制进行底层点击。");
                startButtonHandle = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => b.textContent.includes('启动') || b.textContent.includes('Start'));
                });
            }

            // D. 执行开机点击
            if (startButtonHandle && startButtonHandle.asElement()) {
                console.log("正在强制触发点击启动按钮...");
                await page.evaluate(el => el.click(), startButtonHandle);
                console.log("点击命令已发送。");
                await delay(8000);
            } else {
                console.log("未能定位到任何启动按钮，退出循环。");
                break;
            }

            // E. 检查并应对广告弹窗
            const hasAdPopup = await page.evaluate(() => {
                return document.body.innerText.includes("观看广告") || document.body.innerText.toLowerCase().includes("watch ad");
            });

            if (hasAdPopup) {
                console.log("检测到要求观看广告的弹窗，寻找播放按钮...");
                const adButton = await page.evaluateHandle(() => {
                    const elements = Array.from(document.querySelectorAll('button, a'));
                    return elements.find(el => el.textContent.includes('观看广告') || el.textContent.toLowerCase().includes('watch ad'));
                });

                if (adButton && adButton.asElement()) {
                    await page.evaluate(el => el.click(), adButton);
                    console.log("已强制点击观看广告。等待 25 秒播放完毕...");
                    await delay(25000);
                } else {
                    console.log("未成功定位到广告播放按钮。");
                }
            } else {
                console.log("未检测到广告弹窗。等待 10 秒确认容器是否成功启动...");
                await delay(10000);
            }
        }

    } catch (err) {
        console.error("执行过程中发生异常:", err);
    } finally {
        await browser.close();
        console.log("浏览器已关闭。");
    }
}

run();
