import pptr from "./services/puppeteer";
import { Page, PageEvent, PuppeteerLaunchOptions } from "puppeteer";
import { EventEmitter, setMaxListeners } from 'node:events'

export enum Role {
  USER = "user",
  ASSISTANT = "assistant",
}

export interface ChatHistory {
  role: Role;
  content: string;
}

export interface ChatGPTMessage {
  id: string
  author: ChatGPTAuthor
  create_time: number
  update_time: number | null
  content: ChatGPTContent
  status: 'finished_successfully' | 'in_progress'
  end_turn: boolean | null
  weight: number
  metadata: ChatGPTMetadata
  recipient: 'all'
}

export interface ChatGPTAuthor {
  role: 'assistant' | 'user'
  name: string | null
  metadata: Record<string, unknown>
}

export interface ChatGPTContent {
  content_type: 'text'
  parts?: string[] | undefined
}

export interface ChatGPTMetadata {
  finish_details: ChatGPTFinishDetails
  citations: unknown[]
  gizmo_id: string | null
  is_complete: boolean
  message_type: 'next'
  model_slug: string
  default_model_slug: string
  pad: string
  parent_id: string
  model_switcher_deny: unknown[]
}

export interface ChatGPTFinishDetails {
  type: 'max_tokens' | 'stop'
  stop_tokens: number[]
}

export type ChatGPTRootMessage = {
  message: ChatGPTMessage
  conversation_id: string
  error: string | null
}

export const CHAT_GPT_URL = "https://chat.openai.com";

const CHAT_GPT_MESSAGE_DONE_MARKER = '[DONE]';

const DEFAULT_RESPONSE_TIMEOUT = 1_000;
const DEFAULT_CHANGE_TIMEOUT = 5_000;
const DEFAULT_TIMEOUT = 60_000;

const SELECTOR_SEND_BUTTON = "button[data-testid='send-button']";
const SELECTOR_INPUT = "#prompt-textarea";
const SELECTOR_STOP = "button[aria-label='Stop generating']";

setMaxListeners(100)

async function clickSelectorWhenAvailable(page: Page, selector: string, timeout = DEFAULT_TIMEOUT) {
  await page
    .waitForSelector(selector, { timeout })
    .then((element) => {
      if (!page.isClosed() && element) {
        return element.click();
      }
    })
}

const injectMessageListenerToPage = async (page: Page) => {
  const emitter = new EventEmitter();
  
  const awaitNextCompleteMessage = () => new Promise<string>((resolve) => emitter.once('finish', (messageString: string) => resolve(messageString)));

  let partialMessageParts: string[] = [];

  const sentMessageToHost = (messageJSONString: string) => {
    const rootMessage = JSON.parse(messageJSONString) as ChatGPTRootMessage;

    // In rare cases we amy receive empty messages that result in parts being undefined
    const parts = rootMessage.message.content.parts ?? ['']

    partialMessageParts.push(...parts);

    if (rootMessage.message.metadata.finish_details.type === 'stop') {
      emitter.emit('finish', partialMessageParts.join(''));
      partialMessageParts = [];
    }
  }

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

        async function processText({
          done,
          value,
        }: ReadableStreamReadResult<Uint8Array>): Promise<void> {
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
              const parsed = JSON.parse(chunk) as ChatGPTRootMessage;

              if (parsed?.message?.status === 'finished_successfully' && typeof parsed.message.metadata?.finish_details?.type === 'string') {
                ;(
                  window as unknown as Window & {
                    sentMessageToHost: typeof sentMessageToHost
                  }
                ).sentMessageToHost(chunk);

                reader.releaseLock();
                return Promise.resolve();
              }
            } catch {
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
          } catch {
            return await Promise.resolve();
          }
        }

        try {
          const resultOuter = await reader.read();
          processText(resultOuter);
        } catch {
          /* swallow */
        }

        return response;
      } else {
        return originalFetch(...args);
      }
    }
  }, CHAT_GPT_MESSAGE_DONE_MARKER);

  return { awaitNextCompleteMessage };
}

const awaitInputReady = async (page: Page) => {
  const inputHandle = await page.waitForSelector(SELECTOR_INPUT, { timeout: DEFAULT_TIMEOUT });
  
  await page.waitForSelector(SELECTOR_SEND_BUTTON, { timeout: DEFAULT_TIMEOUT });

  return inputHandle;
};

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
  await inputHandle!.dispose();
};

const init = async (options: PuppeteerLaunchOptions) => {
  const params = { ...options };

  await pptr.init(params);

  const _ = { pptr };

  return { _ };
};

const autoDismissDialogs = (page: Page) => page.on('dialog', dialog => dialog.dismiss());

const createChat = async (newGptUrl = CHAT_GPT_URL) => {
  const history: ChatHistory[] = [];

  const page = await pptr.newPage();

  autoDismissDialogs(page);

  const { awaitNextCompleteMessage } = await injectMessageListenerToPage(page);

  await page.goto(newGptUrl);

  await awaitInputReady(page);

  const send = async (message: string, interruptResponse = false) => {
    await submitMessage(page, message);

    history.push({
      role: Role.USER,
      content: message,
    })

    if (interruptResponse) {
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_RESPONSE_TIMEOUT));
      await clickSelectorWhenAvailable(page, SELECTOR_STOP, DEFAULT_CHANGE_TIMEOUT);
    }
    else {
      const response = await awaitNextCompleteMessage();

      history.push({
        role: Role.ASSISTANT,
        content: response,
      });

      return response;
    }
    
    return null;
  };

  const close = async () => {
    page.removeAllListeners();
    await page.close();
  };

  const _ = { page };

  return {
    _,
    history,
    send,
    close,
  };
};

const singleMessage = async (text: string, newGptUrl = CHAT_GPT_URL) => {
  const chat = await createChat(newGptUrl);
  const response = await chat.send(text);

  if (typeof response !== 'string') {
    throw new Error('initial chat response is not a string');
  }

  await chat.close();

  return response;
};

const close = async (): Promise<void> => {
  await pptr.close();
};

const _ = { pptr };

export { init, singleMessage, createChat, close, _ };
