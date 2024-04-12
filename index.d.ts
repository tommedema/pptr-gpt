import { Page, PuppeteerLaunchOptions } from "puppeteer";
declare enum Role {
    USER = "user",
    ASSISTANT = "assistant"
}
interface ChatHistory {
    role: Role;
    content: string;
}
declare const init: (options: PuppeteerLaunchOptions) => Promise<{
    _: {
        pptr: {
            browser: null;
            init: (options: PuppeteerLaunchOptions) => Promise<any>;
            goTo: (url: string, viewPort?: import("puppeteer").Viewport | undefined) => Promise<Page>;
            close: () => Promise<void>;
        };
    };
}>;
declare const singleMessage: (text: string) => Promise<string | null>;
declare const createChat: (initialMessage?: string) => Promise<{
    _: {
        page: Page;
    };
    response: string | null;
    history: ChatHistory[];
    send: (message: string) => Promise<string | null>;
    close: () => Promise<void>;
}>;
declare const close: () => Promise<void>;
declare const _: {
    pptr: {
        browser: null;
        init: (options: PuppeteerLaunchOptions) => Promise<any>;
        goTo: (url: string, viewPort?: import("puppeteer").Viewport | undefined) => Promise<Page>;
        close: () => Promise<void>;
    };
};
export { init, singleMessage, createChat, close, _ };
