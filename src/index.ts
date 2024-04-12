import pptr from "./services/puppeteer";
import { convert } from "html-to-text";
import { Page, PuppeteerLaunchOptions } from "puppeteer";

const CHAT_GPT_URL = "https://chat.openai.com";

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: null,
};

enum Role {
  USER = "user",
  ASSISTANT = "assistant",
}

interface ChatHistory {
  role: Role;
  content: string;
}

const DEFAULT_TIMEOUT = 60_000
const DEFAULT_OUTPUT_TIMEOUT = 300_000
const DEFAULT_CHANGE_TIMEOUT = 5_000

const DEFAULT_WAIT_SETTINGS = {
  timeout: DEFAULT_TIMEOUT
};

const SELECTOR_SEND_BUTTON = `document.querySelector("button[data-testid='send-button']")`;
const SELECTOR_INPUT = "#prompt-textarea";
const SELECTOR_ASSISTANT_MESSAGE = 'div[data-message-author-role="assistant"]';

const awaitInputReady = async (page: Page) => {
  const inputHandle = await page.waitForSelector(SELECTOR_INPUT, DEFAULT_WAIT_SETTINGS);
  
  await page.waitForSelector(SELECTOR_SEND_BUTTON, DEFAULT_WAIT_SETTINGS);

  return inputHandle;
}

function clickTextWhenAvailable(page: Page, text: string, elementTag = 'div', timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
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
              clickTextWhenAvailable(page, text, elementTag, timeout, abortController)
            }
          })
      }
    })
    .catch((error) => {
      // Swallow
      console.log(`Failed to find or click element: ${error}`);
    })

  return () => abortController.abort()
}
const awaitOutputReady = async (page: Page) => {
  const abortRegenerateClick = clickTextWhenAvailable(page, 'Regenerate', 'div', DEFAULT_OUTPUT_TIMEOUT);

  try {
    await page.waitForSelector(SELECTOR_SEND_BUTTON, { timeout: DEFAULT_CHANGE_TIMEOUT, hidden: true });
  }
  catch {}

  await page.waitForSelector(SELECTOR_SEND_BUTTON, { timeout: DEFAULT_OUTPUT_TIMEOUT });

  abortRegenerateClick();
}

const submitMessage = async (page: Page, text: string): Promise<void> => {
  const inputHandle = await awaitInputReady(page);
  
  const sections = text.split('\n');
  for (const section of sections) {
    await inputHandle!.type(section);
    await page.keyboard.down('Shift');
    await inputHandle!.press('Enter');
    await page.keyboard.up('Shift');
  }

  await inputHandle!.press('Enter');
  inputHandle!.dispose();
};

const init = async (options: PuppeteerLaunchOptions) => {
  const params = { ...options };

  await pptr.init(params);

  const _ = { pptr };

  return { _ };
};

const queryPage = async (page: Page, text: string) => {
  await submitMessage(page, text);

  await awaitOutputReady(page);

  const assistantResponseHTML = await page.evaluate((selector) => {
    const elements = document.querySelectorAll<HTMLDivElement>(selector);

    if (elements.length === 0) {
      return null;
    }

    return elements[elements.length - 1].innerHTML;
  }, SELECTOR_ASSISTANT_MESSAGE);

  if (!assistantResponseHTML) {
    return null;
  }

  return convert(assistantResponseHTML, HTML_TO_TEXT_OPTIONS).trim();
}

const singleMessage = async (text: string) => {
  const page = await pptr.goTo(CHAT_GPT_URL);

  const response = await queryPage(page, text);

  await page.close();

  return response;
};

const createChat = async (initialMessage?: string) => {
  const history: ChatHistory[] = [];
  const page = await pptr.goTo(CHAT_GPT_URL);

  const send = async (message: string)=> {
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

const close = async (): Promise<void> => {
  await pptr.close();
};

const _ = { pptr };

export { init, singleMessage, createChat, close, _ };