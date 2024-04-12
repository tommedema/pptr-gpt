import { Browser, PuppeteerLaunchOptions, Viewport } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const usePuppeteer = () => {
  let browser: Browser | null = null;

  const init = async (options: PuppeteerLaunchOptions): Promise<any> => {
    const params: PuppeteerLaunchOptions = {
      headless: 'shell',
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-setuid-sandbox', '--incognito'],
      ...options,
    }

    browser = await puppeteer.launch(params);

    return browser;
  };

  const goTo = async (url: string, viewPort?: Viewport) => {
    if (!browser) {
      throw new Error('browser not yet initialized')
    }

    const page = await browser.newPage();

    await page.goto(url);

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

  return { browser, init, goTo, close, _ };
}

export default usePuppeteer()