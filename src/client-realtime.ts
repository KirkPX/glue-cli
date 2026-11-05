import { StreamChat, type Event, type Channel } from 'stream-chat';
import type { GlueAPIClient } from './client-graphql.js';
import { requireChatKey } from './config.js';
import { callWithPolicy, resolveTimeoutMs, type RetryMode } from './client.js';

const STREAM_CHANNEL_TYPE = 'thread';

function stream<T>(operation: string, retry: RetryMode, call: () => Promise<T>): Promise<T> {
  return callWithPolicy(call, {
    operation: `Stream ${operation}`,
    retry,
    statusOf: (error: any) => error?.response?.status ?? error?.status,
    retryAfterOf: (error: any) => error?.response?.headers?.['retry-after'],
  });
}

export type StreamEventHandler = (event: Event) => void;

export class StreamService {
  private client: StreamChat;
  private apiClient: GlueAPIClient;
  private userId: string;
  private connected = false;

  constructor(apiClient: GlueAPIClient, userId: string) {
    this.apiClient = apiClient;
    this.userId = userId;
    this.client = StreamChat.getInstance(requireChatKey(), {
      allowServerSideConnect: true,
      timeout: resolveTimeoutMs(),
    });
    if (process.env.GLUE_STREAM_URL) this.client.setBaseURL(process.env.GLUE_STREAM_URL);
  }

  async connect(): Promise<void> {
    const tokenProvider = async () => {
      const { streamToken } = await this.apiClient.getStreamConfig();
      return streamToken;
    };

    await stream('connect', 'safe', () => this.client.connectUser({ id: this.userId }, tokenProvider));
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnectUser();
      this.connected = false;
    }
  }

  on(event: string, handler: StreamEventHandler): { unsubscribe: () => void } {
    return this.client.on(event, handler);
  }

  async watchChannel(channelId: string): Promise<Channel> {
    const channel = this.client.channel(STREAM_CHANNEL_TYPE, channelId);
    await stream('watch channel', 'safe', () => channel.watch());
    return channel;
  }

  // Add a reaction to a message. streamMessageId is the GetStream ID (message.streamID from GraphQL).
  async sendReaction(threadId: string, streamMessageId: string, type: string) {
    const channel = await this.watchChannel(threadId);
    return stream('send reaction', 'rate-limit', () => channel.sendReaction(streamMessageId, { type }));
  }

  // Remove a reaction the current user previously added.
  async deleteReaction(threadId: string, streamMessageId: string, type: string) {
    const channel = await this.watchChannel(threadId);
    return stream('delete reaction', 'rate-limit', () => channel.deleteReaction(streamMessageId, type));
  }

  // Send a quote-reply. streamMessageId is the target message's GetStream ID.
  async sendQuote(threadId: string, streamMessageId: string, text: string) {
    const channel = await this.watchChannel(threadId);
    return stream('send quote', 'rate-limit', () => channel.sendMessage({ text, quoted_message_id: streamMessageId }));
  }

  // Fetch a channel's messages without subscribing (no watch). Returns the raw
  // GetStream message objects (string timestamps), newest-last. Used by the
  // rename audit to scan many threads' system/activity messages cheaply.
  async queryChannelMessages(threadId: string, limit = 200): Promise<any[]> {
    const channel = this.client.channel(STREAM_CHANNEL_TYPE, threadId);
    const res = await stream('read channel', 'safe', () => channel.query({ messages: { limit } }));
    return (res.messages || []) as any[];
  }

  async queryChannels(filter: Record<string, any> = {}): Promise<Channel[]> {
    return stream('list channels', 'safe', () => this.client.queryChannels(
      { type: STREAM_CHANNEL_TYPE, members: { $in: [this.userId] }, ...filter },
      { last_message_at: -1 },
      { limit: 30 },
    ));
  }

  getClient(): StreamChat {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export { STREAM_CHANNEL_TYPE };
