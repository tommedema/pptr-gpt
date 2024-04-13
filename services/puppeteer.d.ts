import { PuppeteerLaunchOptions, Viewport } from 'puppeteer';
declare const _default: {
    browser: null;
    init: (options: PuppeteerLaunchOptions) => Promise<any>;
    newPage: (url?: string | undefined, viewPort?: Viewport | undefined) => Promise<import("puppeteer").Page>;
    close: () => Promise<void>;
    _: {
        puppeteer: import("puppeteer-extra").PuppeteerExtra;
    };
};
export default _default;
