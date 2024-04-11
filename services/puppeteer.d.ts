import { PuppeteerLaunchOptions } from 'puppeteer';
declare const _default: {
    browser: null;
    init: (options: PuppeteerLaunchOptions) => Promise<any>;
    goTo: (url: string) => Promise<import("puppeteer").Page>;
    close: () => Promise<void>;
};
export default _default;
