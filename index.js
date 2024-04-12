"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._ = exports.close = exports.createChat = exports.singleMessage = exports.init = void 0;
const puppeteer_1 = __importDefault(require("./services/puppeteer"));
const html_to_text_1 = require("html-to-text");
const CHAT_GPT_URL = "https://chat.openai.com";
const HTML_TO_TEXT_OPTIONS = {
    wordwrap: null,
};
var Role;
(function (Role) {
    Role["USER"] = "user";
    Role["ASSISTANT"] = "assistant";
})(Role || (Role = {}));
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_OUTPUT_TIMEOUT = 300000;
const DEFAULT_CHANGE_TIMEOUT = 5000;
const DEFAULT_WAIT_SETTINGS = {
    timeout: DEFAULT_TIMEOUT
};
const SELECTOR_SEND_BUTTON = `document.querySelector("button[data-testid='send-button']")`;
const SELECTOR_INPUT = "#prompt-textarea";
const SELECTOR_ASSISTANT_MESSAGE = 'div[data-message-author-role="assistant"]';
const awaitInputReady = async (page) => {
    const inputHandle = await page.waitForSelector(SELECTOR_INPUT, DEFAULT_WAIT_SETTINGS);
    await page.waitForSelector(SELECTOR_SEND_BUTTON, DEFAULT_WAIT_SETTINGS);
    return inputHandle;
};
function clickTextWhenAvailable(page, text, elementTag = 'div', timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
    const selector = `xpath/${elementTag}[contains(text(), "${text}")]`;
    page
        .waitForSelector(selector, { timeout, signal: abortController.signal })
        .then((element) => {
        if (!abortController.signal.aborted) {
            if (element) {
                element.click();
                element.dispose();
            }
            page
                .waitForSelector(selector, { timeout, signal: abortController.signal, hidden: true })
                .then(() => {
                if (!abortController.signal.aborted) {
                    clickTextWhenAvailable(page, text, elementTag, timeout, abortController);
                }
            });
        }
    })
        .catch((error) => {
        // Swallow
        console.log(`Failed to find or click element: ${error}`);
    });
    return () => abortController.abort();
}
const awaitOutputReady = async (page) => {
    const abortRegenerateClick = clickTextWhenAvailable(page, 'Regenerate', 'div', DEFAULT_OUTPUT_TIMEOUT);
    try {
        await page.waitForSelector(SELECTOR_SEND_BUTTON, { timeout: DEFAULT_CHANGE_TIMEOUT, hidden: true });
    }
    catch (_a) { }
    await page.waitForSelector(SELECTOR_SEND_BUTTON, { timeout: DEFAULT_OUTPUT_TIMEOUT });
    abortRegenerateClick();
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
    inputHandle.dispose();
};
const init = async (options) => {
    const params = Object.assign({}, options);
    await puppeteer_1.default.init(params);
    const _ = { pptr: puppeteer_1.default };
    return { _ };
};
exports.init = init;
const queryPage = async (page, text) => {
    await submitMessage(page, text);
    await awaitOutputReady(page);
    const assistantResponseHTML = await page.evaluate((selector) => {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) {
            return null;
        }
        return elements[elements.length - 1].innerHTML;
    }, SELECTOR_ASSISTANT_MESSAGE);
    if (!assistantResponseHTML) {
        return null;
    }
    return (0, html_to_text_1.convert)(assistantResponseHTML, HTML_TO_TEXT_OPTIONS).trim();
};
const autoDismissDialogs = (page) => page.on('dialog', dialog => dialog.dismiss());
const singleMessage = async (text) => {
    const page = await puppeteer_1.default.goTo(CHAT_GPT_URL);
    autoDismissDialogs(page);
    const response = await queryPage(page, text);
    await page.close();
    return response;
};
exports.singleMessage = singleMessage;
const createChat = async (initialMessage) => {
    const history = [];
    const page = await puppeteer_1.default.goTo(CHAT_GPT_URL);
    autoDismissDialogs(page);
    const send = async (message) => {
        const answer = await queryPage(page, message);
        if (!answer) {
            return null;
        }
        history.push({
            role: Role.USER,
            content: message,
        });
        history.push({
            role: Role.ASSISTANT,
            content: answer,
        });
        return answer;
    };
    const close = async () => {
        await page.close();
    };
    await awaitInputReady(page);
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
const close = async () => {
    await puppeteer_1.default.close();
};
exports.close = close;
const _ = { pptr: puppeteer_1.default };
exports._ = _;
