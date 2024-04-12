import pptr from "./services/puppeteer";
import { convert } from "html-to-text";
import storage from "./services/storage";
import path from "path";
import fs from "fs";
import { Page, PuppeteerLaunchOptions } from "puppeteer";

const CHAT_GPT_URL = "https://chat.openai.com";
const PREPAND = "ChatGPT\nChatGPT";

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: null,
}

enum Role {
  USER = "user",
  ASSISTANT = "assistant",
}

interface ChatHistory {
  role: Role;
  content: string;
}

const DEFAULT_WAIT_SETTINGS = {
  timeout: 60_000
}

const SELECTOR_SEND_BUTTON = `document.querySelector("button[data-testid='send-button']")`
const SELECTOR_INPUT = "#prompt-textarea"
const SELECTOR_ASSISTANT_MESSAGE = 'div[data-message-author-role="assistant"]'

const typeSubmit = async (page: Page, text: string): Promise<void> => {
  const inputHandle = await page.waitForSelector(SELECTOR_INPUT, { timeout: 60_000 })
  
  const sections = text.split('\n')
  for (const section of sections) {
    await inputHandle!.type(section)
    await page.keyboard.down('Shift')
    await inputHandle!.press('Enter')
    await page.keyboard.up('Shift')
  }

  await inputHandle!.press('Enter');
  inputHandle!.dispose()
};

const init = async (options: PuppeteerLaunchOptions & {
  screenshots?: boolean;
}) => {
  const params = { ...options };

  if (options.hasOwnProperty('screenshots')) {
    storage.set('screenshots', String(options.screenshots) as string);

    // create public directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'public'))) {
      fs.mkdirSync(path.join(__dirname, 'public'));
    }
  }

  await pptr.init(params);

  const _ = { pptr }

  return { _ }
};

const singleMessage = async (text: string) => {
  const page = await pptr.goTo(CHAT_GPT_URL);
  const screenshots = storage.get('screenshots');
  
  if (screenshots) {
    await page.screenshot({ path: path.join(__dirname, 'public/screenshot.png') });

  }

  await page.waitForSelector(SELECTOR_INPUT, DEFAULT_WAIT_SETTINGS);

  await typeSubmit(page, text);

  if (screenshots) {
    await page.screenshot({ path: path.join(__dirname, 'public/screenshot2.png') });
  }

  await page.waitForSelector(SELECTOR_SEND_BUTTON, { ...DEFAULT_WAIT_SETTINGS, hidden: true })
  await page.waitForSelector(SELECTOR_SEND_BUTTON, DEFAULT_WAIT_SETTINGS)

  const assistantResponseHTML = await page.evaluate((selector) => {
    const elements = document.querySelectorAll<HTMLDivElement>(selector);

    if (elements.length === 0) {
      return null
    }

    return elements[elements.length - 1].innerHTML;
  }, SELECTOR_ASSISTANT_MESSAGE);

  await page.close();

  if (!assistantResponseHTML) {
    return null
  }

  return convert(assistantResponseHTML, HTML_TO_TEXT_OPTIONS).trim();
};

const createChat = async (text: string) => {
  let responseMessageId = 3;

  const history: ChatHistory[] = [];
  const page = await pptr.goTo(CHAT_GPT_URL);

  const send = async (message: string): Promise<string> => {
    const screenshots = storage.get('screenshots');
  
    await typeSubmit(page, message);
  
    if (screenshots) {
      await page.screenshot({ path: path.join(__dirname, `public/screenshot-${responseMessageId + 1}.png`) });
    }

    history.push({
      role: Role.USER,
      content: message,
    });

    const response = await page.evaluate(
      async ({ responseMessageId }: { responseMessageId: number }) => {
        let prevText: string | null = null;
        let currentText: any = document.querySelector(
          `div[data-testid='conversation-turn-${responseMessageId}']`
        )?.innerHTML;

        const getHTML = async (): Promise<string> => {
          return new Promise((resolve) => {
            const interval = setInterval(() => {
              prevText = currentText;

              currentText = document.querySelector(
                `div[data-testid='conversation-turn-${responseMessageId}']`
              )?.innerHTML;

              if (currentText && prevText === currentText) {
                clearInterval(interval);

                resolve(currentText);
              }
            }, 3000);
          });
        };

        return getHTML();
      },
      {
        responseMessageId,
      }
    );

    responseMessageId += 2;

    const answer = convert(response, HTML_TO_TEXT_OPTIONS)
      .replace(PREPAND, "")
      .trim();

    history.push({
      role: Role.ASSISTANT,
      content: answer,
    });

    return answer;
  };

  const close = async (): Promise<void> => {
    await page.close();
  };

  await page.waitForSelector("#prompt-textarea", {
    timeout: 60_000
  });
  const response = await send(text);

  const _ = { page }

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

const _ = { pptr }

export { init, singleMessage, createChat, close, _ };