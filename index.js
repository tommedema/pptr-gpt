"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._ = exports.close = exports.createChat = exports.singleMessage = exports.init = exports.CHAT_GPT_URL = exports.Role = void 0;
const puppeteer_1 = __importDefault(require("./services/puppeteer"));
const node_events_1 = require("node:events");
var Role;
(function (Role) {
    Role["USER"] = "user";
    Role["ASSISTANT"] = "assistant";
})(Role || (exports.Role = Role = {}));
exports.CHAT_GPT_URL = "https://chat.openai.com";
const CHAT_GPT_MESSAGE_DONE_MARKER = '[DONE]';
const DEFAULT_CHANGE_TIMEOUT = 5000;
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_WAIT_SETTINGS = {
    timeout: DEFAULT_TIMEOUT
};
const SELECTOR_SEND_BUTTON = "button[data-testid='send-button']";
const SELECTOR_INPUT = "#prompt-textarea";
const SELECTOR_SCROLL_DOWN = "button.rounded-full.bg-clip-padding:has(> svg)";
function clickSelectorWhenAvailable(page, selector, timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
    const cleanup = () => {
        page.off("close" /* PageEvent.Close */, cleanup);
        if (!abortController.signal.aborted) {
            abortController.abort();
        }
    };
    if (page.isClosed()) {
        cleanup();
        return () => { };
    }
    else {
        page.once("close" /* PageEvent.Close */, cleanup);
    }
    if (!abortController.signal.aborted) {
        page
            .waitForSelector(selector, { timeout, signal: abortController.signal })
            .then(async (element) => {
            if (!abortController.signal.aborted && !page.isClosed()) {
                if (element) {
                    try {
                        await element.click();
                    }
                    catch (error) {
                        console.error("Failed to click element: " + error.message);
                        throw error;
                    }
                    if (!abortController.signal.aborted && !page.isClosed()) {
                        try {
                            await element.dispose();
                        }
                        catch (error) {
                            console.error("Failed to dispose element: " + error.message);
                            throw error;
                        }
                    }
                    if (!abortController.signal.aborted && !page.isClosed()) {
                        try {
                            await page.waitForSelector(selector, { timeout: timeout === 0 ? DEFAULT_CHANGE_TIMEOUT : Math.min(timeout, DEFAULT_CHANGE_TIMEOUT), signal: abortController.signal, hidden: true });
                        }
                        catch (_a) {
                            /* swallow */
                        }
                    }
                }
                if (!abortController.signal.aborted && !page.isClosed()) {
                    return clickSelectorWhenAvailable(page, selector, timeout, abortController);
                }
            }
        })
            .catch((error) => {
            if (!abortController.signal.aborted && error.name !== "AbortError" && !page.isClosed()) {
                console.trace("Show stack trace");
                cleanup();
                throw new Error(`Failed to find or click element: ${error.name} ${error.message}`);
            }
        });
    }
    return cleanup;
}
function clickTextWhenAvailable(page, text, elementTag = 'div', timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
    const selector = `xpath/${elementTag}[contains(text(), "${text}")]`;
    return clickSelectorWhenAvailable(page, selector, timeout, abortController);
}
const injectMessageListenerToPage = async (page) => {
    const abortListener1 = clickTextWhenAvailable(page, 'Regenerate', 'div', 0);
    const abortListener2 = clickTextWhenAvailable(page, 'Continue generating', 'div', 0);
    const abortListener3 = clickSelectorWhenAvailable(page, SELECTOR_SCROLL_DOWN, 0);
    const abortListeners = () => {
        abortListener1();
        abortListener2();
        abortListener3();
    };
    const emitter = new node_events_1.EventEmitter();
    const awaitNextCompleteMessage = () => new Promise((resolve) => emitter.once('finish', (messageString) => resolve(messageString)));
    let partialMessageParts = [];
    const sentMessageToHost = (messageJSONString) => {
        const rootMessage = JSON.parse(messageJSONString);
        partialMessageParts.push(...rootMessage.message.content.parts);
        if (rootMessage.message.metadata.finish_details.type === 'stop') {
            emitter.emit('finish', partialMessageParts.join(''));
            partialMessageParts = [];
        }
    };
    await page.exposeFunction('sentMessageToHost', sentMessageToHost);
    await page.evaluateOnNewDocument((CHAT_GPT_MESSAGE_DONE_MARKER) => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const url = args[0] instanceof URL ? args[0].href : args[0].toString();
            if (url.includes('/conversation') && args[1] && args[1].method === 'POST') {
                const response = await originalFetch(...args);
                if (!response.ok) {
                    return response;
                }
                const clonedResponse = response.clone();
                if (!clonedResponse.body) {
                    return response;
                }
                const reader = clonedResponse.body.getReader();
                const decoder = new TextDecoder('utf-8', { fatal: false });
                async function processText({ done, value, }) {
                    var _a, _b, _c;
                    const streamChunk = decoder.decode(value, { stream: true });
                    const chunkStrings = streamChunk
                        .split('data: ')
                        .map((s) => s.trim())
                        .filter((s) => s);
                    for (const chunk of chunkStrings) {
                        if (chunk === CHAT_GPT_MESSAGE_DONE_MARKER) {
                            reader.releaseLock();
                            return Promise.resolve();
                        }
                        try {
                            const parsed = JSON.parse(chunk);
                            if (((_a = parsed === null || parsed === void 0 ? void 0 : parsed.message) === null || _a === void 0 ? void 0 : _a.status) === 'finished_successfully' && typeof ((_c = (_b = parsed.message.metadata) === null || _b === void 0 ? void 0 : _b.finish_details) === null || _c === void 0 ? void 0 : _c.type) === 'string') {
                                ;
                                window.sentMessageToHost(chunk);
                                reader.releaseLock();
                                return Promise.resolve();
                            }
                        }
                        catch (_d) {
                            /* swallow */
                        }
                    }
                    if (done) {
                        reader.releaseLock();
                        return Promise.resolve();
                    }
                    // Recurse into the next part of the stream
                    try {
                        const resultInner = await reader.read();
                        return processText(resultInner);
                    }
                    catch (_e) {
                        return await Promise.resolve();
                    }
                }
                try {
                    const resultOuter = await reader.read();
                    processText(resultOuter);
                }
                catch (_a) {
                    /* swallow */
                }
                return response;
            }
            else {
                return originalFetch(...args);
            }
        };
    }, CHAT_GPT_MESSAGE_DONE_MARKER);
    return { awaitNextCompleteMessage, abortListeners };
};
const awaitInputReady = async (page) => {
    const inputHandle = await page.waitForSelector(SELECTOR_INPUT, DEFAULT_WAIT_SETTINGS);
    await page.waitForSelector(SELECTOR_SEND_BUTTON, DEFAULT_WAIT_SETTINGS);
    return inputHandle;
};
const submitMessage = async (page, text) => {
    const inputHandle = await awaitInputReady(page);
    const sections = text.split('\n');
    for (const section of sections) {
        await inputHandle.type(section);
        await page.keyboard.down('Shift');
        await inputHandle.press('Enter');
        await page.keyboard.up('Shift');
    }
    await inputHandle.press('Enter');
    await inputHandle.dispose();
};
const init = async (options) => {
    const params = Object.assign({}, options);
    await puppeteer_1.default.init(params);
    const _ = { pptr: puppeteer_1.default };
    return { _ };
};
exports.init = init;
const autoDismissDialogs = (page) => page.on('dialog', dialog => dialog.dismiss());
const createChat = async (initialMessage) => {
    const history = [];
    const page = await puppeteer_1.default.newPage();
    autoDismissDialogs(page);
    const { awaitNextCompleteMessage, abortListeners } = await injectMessageListenerToPage(page);
    await page.goto(exports.CHAT_GPT_URL);
    await awaitInputReady(page);
    const send = async (message) => {
        await submitMessage(page, message);
        const response = await awaitNextCompleteMessage();
        history.push({
            role: Role.USER,
            content: message,
        }, {
            role: Role.ASSISTANT,
            content: response,
        });
        return response;
    };
    const close = async () => {
        page.removeAllListeners();
        abortListeners();
        await page.close();
    };
    const response = initialMessage ? await send(initialMessage) : null;
    const _ = { page };
    return {
        _,
        response,
        history,
        send,
        close,
    };
};
exports.createChat = createChat;
const singleMessage = async (text) => {
    const chat = await createChat(text);
    if (typeof chat.response !== 'string') {
        throw new Error('initial chat response is not a string');
    }
    await chat.close();
    return chat.response;
};
exports.singleMessage = singleMessage;
const close = async () => {
    await puppeteer_1.default.close();
};
exports.close = close;
const _ = { pptr: puppeteer_1.default };
exports._ = _;
