import pptr from "./services/puppeteer";
import { Page, PageEvent, PuppeteerLaunchOptions } from "puppeteer";
import { EventEmitter } from 'node:events'

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
  parts: string[]
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

const DEFAULT_CHANGE_TIMEOUT = 5_000;
const DEFAULT_TIMEOUT = 60_000;

const DEFAULT_WAIT_SETTINGS = {
  timeout: DEFAULT_TIMEOUT
};

const SELECTOR_SEND_BUTTON = "button[data-testid='send-button']";
const SELECTOR_INPUT = "#prompt-textarea";

function clickTextWhenAvailable(page: Page, text: string, elementTag = 'div', timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
  const selector = `xpath/${elementTag}[contains(text(), "${text}")]`;

  const handlePageClose = () => abortController.abort();

  if (page.isClosed()) {
    handlePageClose();
  }
  else {
    page.once(PageEvent.Close, handlePageClose);
  }

  if (!abortController.signal.aborted) {
    page
      .waitForSelector(selector, { timeout, signal: abortController.signal })
      .then(async (element) => {
        if (!abortController.signal.aborted) {
          if (element) {
            await element.click();
            await element.dispose();

            if (!abortController.signal.aborted) {
              try {
                await page.waitForSelector(selector, { timeout: timeout === 0 ? DEFAULT_CHANGE_TIMEOUT : Math.min(timeout, DEFAULT_CHANGE_TIMEOUT), signal: abortController.signal, hidden: true });
              } catch {
                /* swallow */
              }
            }
          }
          
          if (!abortController.signal.aborted) {
            return clickTextWhenAvailable(page, text, elementTag, timeout, abortController);
          }
        }
      })
      .catch((error: Error) => {
        if (!abortController.signal.aborted && error.name !== "AbortError") {
          console.trace("Show stack trace");
          throw new Error(`Failed to find or click element: ${error.name} ${error.message}`);
        }
      }); 
  }

  return () => {
    page.off(PageEvent.Close, handlePageClose);
    abortController.abort();
  }
}

const injectMessageListenerToPage = async (page: Page) => {
  const abortListener1 = clickTextWhenAvailable(page, 'Regenerate', 'div', 0);
  const abortListener2 = clickTextWhenAvailable(page, 'Continue generating', 'div', 0);

  const abortListeners = () => {
    abortListener1();
    abortListener2();
  };

  const emitter = new EventEmitter();
  
  const awaitNextCompleteMessage = () => new Promise<string>((resolve) => emitter.once('finish', (messageString: string) => resolve(messageString)));

  let partialMessageParts: string[] = [];

  const sentMessageToHost = (messageJSONString: string) => {
    const rootMessage = JSON.parse(messageJSONString) as ChatGPTRootMessage;

    partialMessageParts.push(...rootMessage.message.content.parts);

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

  return { awaitNextCompleteMessage, abortListeners };
}

const awaitInputReady = async (page: Page) => {
  const inputHandle = await page.waitForSelector(SELECTOR_INPUT, DEFAULT_WAIT_SETTINGS);
  
  await page.waitForSelector(SELECTOR_SEND_BUTTON, DEFAULT_WAIT_SETTINGS);

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

const createChat = async (initialMessage?: string) => {
  const history: ChatHistory[] = [];

  const page = await pptr.newPage();

  autoDismissDialogs(page);

  const { awaitNextCompleteMessage, abortListeners } = await injectMessageListenerToPage(page);

  await page.goto(CHAT_GPT_URL);

  await awaitInputReady(page);

  const send = async (message: string) => {
    await submitMessage(page, message);

    const response = await awaitNextCompleteMessage();

    history.push(
      {
        role: Role.USER,
        content: message,
      },
      {
        role: Role.ASSISTANT,
        content: response,
      }
    );

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

const singleMessage = async (text: string) => {
  const chat = await createChat(text);

  if (typeof chat.response !== 'string') {
    throw new Error('initial chat response is not a string');
  }

  await chat.close();

  return chat.response;
};

const close = async (): Promise<void> => {
  await pptr.close();
};

const _ = { pptr };

export { init, singleMessage, createChat, close, _ };
