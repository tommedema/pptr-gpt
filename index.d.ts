import { Page, PuppeteerLaunchOptions } from "puppeteer";
export declare enum Role {
    USER = "user",
    ASSISTANT = "assistant"
}
export interface ChatHistory {
    role: Role;
    content: string;
}
export interface ChatGPTMessage {
    id: string;
    author: ChatGPTAuthor;
    create_time: number;
    update_time: number | null;
    content: ChatGPTContent;
    status: 'finished_successfully' | 'in_progress';
    end_turn: boolean | null;
    weight: number;
    metadata: ChatGPTMetadata;
    recipient: 'all' | string;
}
export interface ChatGPTAuthor {
    role: 'assistant' | 'user';
    name: string | null;
    metadata: Record<string, unknown>;
}
export interface ChatGPTContent {
    content_type: 'text';
    parts?: string[] | undefined;
}
export interface ChatGPTMetadata {
    finish_details: ChatGPTFinishDetails;
    citations: unknown[];
    gizmo_id: string | null;
    is_complete: boolean;
    message_type: 'next';
    model_slug: string;
    default_model_slug: string;
    pad: string;
    parent_id: string;
    model_switcher_deny: unknown[];
}
export interface ChatGPTFinishDetails {
    type: 'max_tokens' | 'stop';
    stop_tokens: number[];
}
export type ChatGPTRootMessage = {
    message: ChatGPTMessage;
    conversation_id: string;
    error: string | null;
};
export declare const CHAT_GPT_URL = "https://chat.openai.com";
declare const init: (options: PuppeteerLaunchOptions) => Promise<{
    _: {
        pptr: {
            browser: null;
            init: (options: PuppeteerLaunchOptions) => Promise<import("puppeteer").Browser>;
            newPage: (url?: string | undefined, viewPort?: import("puppeteer").Viewport | undefined) => Promise<Page>;
            close: () => Promise<void>;
            _: {
                puppeteer: import("puppeteer-extra").PuppeteerExtra;
            };
        };
    };
}>;
declare const createChat: (newGptUrl?: string) => Promise<{
    _: {
        page: Page;
    };
    history: ChatHistory[];
    send: (message: string, interruptResponse?: boolean) => Promise<string | null>;
    close: () => Promise<void>;
}>;
declare const singleMessage: (text: string, newGptUrl?: string) => Promise<string>;
declare const close: () => Promise<void>;
declare const _: {
    pptr: {
        browser: null;
        init: (options: PuppeteerLaunchOptions) => Promise<import("puppeteer").Browser>;
        newPage: (url?: string | undefined, viewPort?: import("puppeteer").Viewport | undefined) => Promise<Page>;
        close: () => Promise<void>;
        _: {
            puppeteer: import("puppeteer-extra").PuppeteerExtra;
        };
    };
};
export { init, singleMessage, createChat, close, _ };
