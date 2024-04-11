import { PuppeteerLaunchOptions } from 'puppeteer';
declare const _default: {
    browser: any;
    init: (options: PuppeteerLaunchOptions) => Promise<any>;
    goTo: (url: string) => Promise<any>;
    close: () => Promise<void>;
};
export default _default;
