import { Page, PuppeteerLaunchOptions } from "puppeteer";
declare enum Role {
    USER = "user",
    ASSISTANT = "assistant"
}
interface ChatHistory {
    role: Role;
    content: string;
}
declare const init: (options: PuppeteerLaunchOptions & {
    screenshots?: boolean;
}) => Promise<void>;
declare const singleMessage: (text: string) => Promise<string>;
declare const createChat: (text: string) => Promise<{
    _: {
        page: Page;
        puppeteer: {
            browser: null;
            init: (options: PuppeteerLaunchOptions) => Promise<any>;
            goTo: (url: string) => Promise<Page>;
            close: () => Promise<void>;
        };
    };
    response: string;
    history: ChatHistory[];
    send: (message: string) => Promise<string>;
    close: () => Promise<void>;
}>;
declare const close: () => Promise<void>;
export { init, singleMessage, createChat, close };
