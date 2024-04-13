import { Browser, PuppeteerLaunchOptions, Viewport } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const usePuppeteer = () => {
  let browser: Browser | null = null;

  const init = async (options: PuppeteerLaunchOptions) => {
    const params: PuppeteerLaunchOptions = {
      headless: 'shell',
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-setuid-sandbox', '--incognito'],
      protocolTimeout: 0,
      ...options,
    }

    browser = await puppeteer.launch(params);

    return browser;
  };

  const newPage = async (url?: string, viewPort?: Viewport) => {
    if (!browser) {
      throw new Error('browser not yet initialized')
    }

    const page = await browser.newPage();

    if (url) {
      await page.goto(url);
    }

    await page.setViewport({
      width: 1360,
      height: 980,
      deviceScaleFactor: 1,
      ...viewPort
    });

    return page;
  };

  const close = async (): Promise<void> => {
    await browser?.close();
  };

  const _ = { puppeteer };

  return { browser, init, newPage, close, _ };
}

export default usePuppeteer()