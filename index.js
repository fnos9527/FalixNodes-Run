const { connect } = require("puppeteer-real-browser");
const fs = require('fs');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("正在通过 puppeteer-real-browser 启动浏览器...");
    const { browser, page } = await connect({
        args: [
            "--proxy-server=socks5://127.0.0.1:10808",
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ],
        turnstile: true,
        headless: false,
        connectOption: { defaultViewport: { width: 1280, height: 800 } }
    });

    try {
        // 1. 登录流程
        console.log("正在打开登录页面...");
        await page.goto("https://client.falixnodes.net/auth/login", { waitUntil: "networkidle2" });
        await delay(8000); // 等待 Cloudflare 自动检测与验证

        console.log("正在输入登录凭证...");
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', process.env.FALIX_EMAIL);

        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', process.env.FALIX_PASSWORD);

        await delay(2000);
        console.log("正在点击登录按钮...");
        
        // 尝试寻找登录提交按钮
        const loginBtn = await page.$('button[type="submit"]') || await page.$('button');
        if (loginBtn) {
            await loginBtn.click();
        } else {
            throw new Error("未找到登录按钮");
        }

        console.log("等待登录跳转...");
        await delay(10000);
        await page.screenshot({ path: "screenshots/1_login_result.png" });
        console.log("已保存登录结果截图：screenshots/1_login_result.png");

        // 2. 控制台流程
        const consoleUrl = "https://client.falixnodes.net/server/2845100/console";
        console.log(`正在跳转至控制台页面: ${consoleUrl}`);
        await page.goto(consoleUrl, { waitUntil: "networkidle2" });
        await delay(8000);
        await page.screenshot({ path: "screenshots/2_console_loaded.png" });

        // 循环检测与开机（最多尝试 3 次）
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`\n--- 开始执行第 ${attempt}/3 次状态检测与开机尝试 ---`);
            
            const pageContent = await page.content();
            // 检查是否处于 Offline / 离线状态
            const isOffline = pageContent.toLowerCase().includes("offline") || pageContent.includes("离线");

            if (!isOffline) {
                console.log("服务器当前不处于 Offline 状态（可能已开机或正在启动）。流程结束。");
                await page.screenshot({ path: "screenshots/3_server_running_status.png" });
                break;
            }

            console.log("检测到服务器状态为 Offline，准备尝试开机...");

            // 寻找启动按钮
            const startButton = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(b => b.textContent.includes('启动') || b.textContent.toLowerCase().includes('start'));
            });

            if (startButton && startButton.asElement()) {
                await startButton.asElement().click();
                console.log("已点击启动按钮。");
                await delay(5000);
                await page.screenshot({ path: `screenshots/4_after_start_click_attempt_${attempt}.png` });
            } else {
                console.log("未能定位到启动按钮，请检查页面结构。");
                break;
            }

            // 检测是否存在广告弹窗
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
                    await adButton.asElement().click();
                    console.log("已点击观看广告。等待 25 秒播放完毕...");
                    await delay(25000);
                    console.log("正在刷新页面以应用状态...");
                    await page.reload({ waitUntil: "networkidle2" });
                    await delay(8000);
                } else {
                    console.log("虽检测到广告文本，但未能成功点击按钮。刷新页面重试...");
                    await page.reload({ waitUntil: "networkidle2" });
                    await delay(8000);
                }
            } else {
                console.log("未检测到广告弹窗。等待 10 秒确认容器是否成功启动...");
                await delay(10000);
                await page.screenshot({ path: `screenshots/5_final_status_attempt_${attempt}.png` });

                const finalContent = await page.content();
                const stillOffline = finalContent.toLowerCase().includes("offline") || finalContent.includes("离线");
                if (!stillOffline) {
                    console.log("容器已成功离开 Offline 状态。");
                    break;
                } else {
                    console.log("容器仍处于 Offline 状态，准备进行下一次循环尝试。");
                }
            }
        }

    } catch (err) {
        console.error("执行过程中发生异常:", err);
        await page.screenshot({ path: "screenshots/error_occurred.png" });
    } finally {
        await browser.close();
        console.log("浏览器已关闭。");
    }
}

// 创建截图保存目录
if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots');
}

run();
