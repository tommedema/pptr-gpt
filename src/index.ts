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
const SELECTOR_SCROLL_DOWN = "button.rounded-full.bg-clip-padding:has(> svg)";
const SELECTOR_STOP = "button[aria-label='Stop generating']";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  isFulfilled: () => boolean;
}

function createDeferred<T>(): Deferred<T> {
  let externalResolve: (value: T | PromiseLike<T>) => void = undefined!;
  let externalReject: (reason?: any) => void = undefined!;
  let isFulfilled = false;

  const promise = new Promise<T>((resolve, reject) => {
      externalResolve = (value: T | PromiseLike<T>) => {
          if (!isFulfilled) {
              isFulfilled = true;
              resolve(value);
          }
      };
      externalReject = (reason?: any) => {
          if (!isFulfilled) {
              isFulfilled = true;
              reject(reason);
          }
      };
  });

  return {
      promise,
      resolve: externalResolve,
      reject: externalReject,
      isFulfilled: () => isFulfilled
  };
}

function clickSelectorWhenAvailable(page: Page, selector: string, timeout = DEFAULT_TIMEOUT, abortController = new AbortController(), deferred = createDeferred<void>()): [() => void, Promise<void>] {
  const cleanup = () => {
    page.off(PageEvent.Close, cleanup);
    abortController.signal.removeEventListener('abort', cleanup);
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
    if (!deferred.isFulfilled()) {
      deferred.resolve();
    }
  }

  if (page.isClosed()) {
    cleanup();
    return [cleanup, deferred.promise];
  }
  else {
    page.once(PageEvent.Close, cleanup);
    abortController.signal.addEventListener('abort', cleanup);
  }

  if (!abortController.signal.aborted) {
    page
      .waitForSelector(selector, { timeout, signal: abortController.signal })
      .then(async (element) => {
        if (!abortController.signal.aborted && !page.isClosed()) {
          if (element) {
            try {
              await element.click();
            } catch (error) {
                console.error("Failed to click element: " + (error as Error).message);
                throw error;
            }

            if (!abortController.signal.aborted && !page.isClosed()) {
              try {
                await element.dispose();
              } catch (error) {
                  console.error("Failed to dispose element: " + (error as Error).message);
                  throw error;
              }
            }

            if (!abortController.signal.aborted && !page.isClosed()) {
              try {
                await page.waitForSelector(selector, { timeout: timeout === 0 ? DEFAULT_CHANGE_TIMEOUT : Math.min(timeout, DEFAULT_CHANGE_TIMEOUT), signal: abortController.signal, hidden: true });
              } catch {
                /* swallow */
              }
            }
          }
          
          if (!abortController.signal.aborted && !page.isClosed()) {
            clickSelectorWhenAvailable(page, selector, timeout, abortController, deferred);
          }
          else {
            cleanup();
          }
        }
        else {
          cleanup();
        }
      })
      .catch((error: Error) => {
        if (!abortController.signal.aborted && error.name !== "AbortError" && !page.isClosed()) {
          console.warn(`Failed to find or click element: ${error.name} ${error.message}`);
          clickSelectorWhenAvailable(page, selector, timeout, abortController, deferred);
        }
        else {
          cleanup();
        }
      }); 
  }
  else {
    cleanup();
  }

  return [cleanup, deferred.promise];
}

function clickTextWhenAvailable(page: Page, text: string, elementTag = 'div', timeout = DEFAULT_TIMEOUT, abortController = new AbortController()) {
  const selector = `xpath/${elementTag}[contains(text(), "${text}")]`;

  const [cleanup] = clickSelectorWhenAvailable(page, selector, timeout, abortController);

  return cleanup;
}

const injectMessageListenerToPage = async (page: Page) => {
  const abortListener1 = clickTextWhenAvailable(page, 'Regenerate', 'div', 0);
  const abortListener2 = clickTextWhenAvailable(page, 'Continue generating', 'div', 0);
  const [abortListener3] = clickSelectorWhenAvailable(page, SELECTOR_SCROLL_DOWN, 0);

  const abortListeners = () => {
    abortListener1();
    abortListener2();
    abortListener3();
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

  const send = async (message: string, interruptResponse = false) => {
    await submitMessage(page, message);

    history.push({
      role: Role.USER,
      content: message,
    })

    if (interruptResponse) {
      const [cleanup, promise] = clickSelectorWhenAvailable(page, SELECTOR_STOP, DEFAULT_CHANGE_TIMEOUT);
      await promise;
      cleanup();
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
