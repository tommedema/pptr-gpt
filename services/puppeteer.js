"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_extra_1 = __importDefault(require("puppeteer-extra"));
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
const usePuppeteer = () => {
    let browser = null;
    const init = async (options) => {
        const params = Object.assign({ headless: 'shell', ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-setuid-sandbox', '--incognito'] }, options);
        browser = await puppeteer_extra_1.default.launch(params);
        return browser;
    };
    const newPage = async (url, viewPort) => {
        if (!browser) {
            throw new Error('browser not yet initialized');
        }
        const page = await browser.newPage();
        if (url) {
            await page.goto(url);
        }
        await page.setViewport(Object.assign({ width: 1360, height: 980, deviceScaleFactor: 1 }, viewPort));
        return page;
    };
    const close = async () => {
        await (browser === null || browser === void 0 ? void 0 : browser.close());
    };
    const _ = { puppeteer: puppeteer_extra_1.default };
    return { browser, init, newPage, close, _ };
};
exports.default = usePuppeteer();
