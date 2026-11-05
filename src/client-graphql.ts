import { ApolloClient, InMemoryCache, HttpLink, gql, ApolloLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config, signInHint } from './config.js';
import { ApiError, UsageError } from './errors.js';
import { TRANSFER_TIMEOUT_MS, request, safeDetail, type RetryMode } from './client.js';
import { TokenRefreshService } from './services/token-refresh.js';
import type {
  GlueMessage,
  SendMessageResponse,
  DeleteMessageResponse,
  ThreadQueryResponse,
  MeQueryResponse,
} from './types/glue.js';

/**
 * Apollo's transport. A read may retry on 429, 5xx or a lost connection. A mutation retries only on
 * 429, because after a 5xx or a lost connection the change may already have happened.
 */
export const graphqlFetch = async (uri: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  let operationName = 'request';
  let retry: RetryMode = 'rate-limit';
  try {
    const body = JSON.parse(String(init.body));
    operationName = body.operationName ?? operationName;
    if (/^\s*query\b/.test(body.query ?? '')) retry = 'safe';
  } catch {
    // Not the JSON body Apollo sends. Treat it as a change, which is the cautious choice.
  }

  const operation = `GraphQL ${operationName}`;
  const response = await request(String(uri), init, { operation, retry });
  if (response.ok) return response;

  throw new ApiError({
    status: response.status,
    statusText: response.statusText,
    operation,
    safeDetail: safeDetail(await response.text()),
    hint: response.status === 401 || response.status === 403
      ? signInHint()
      : undefined,
  });
};

export class GlueAPIClient {
  private client;
  private tokenService?: TokenRefreshService;

  /** With `accessToken`, uses that token and ignores any saved or environment sign-in. */
  constructor(opts: { accessToken?: string } = {}) {
    // Initialize token refresh service if refresh token is available
    if (!opts.accessToken && config.glue.refreshToken) {
      this.tokenService = new TokenRefreshService(
        config.glue.refreshToken,
        config.glue.accessToken
      );
    }

    // Create HTTP link
    const httpLink = new HttpLink({
      uri: config.glue.apiUrl,
      fetch: graphqlFetch,
    });

    // Create auth link that dynamically provides the token
    const authLink = setContext(async (_, { headers }) => {
      let token = opts.accessToken ?? config.glue.accessToken;

      // Use token service if available
      if (this.tokenService) {
        token = await this.tokenService.getValidToken();
      }

      return {
        headers: {
          ...headers,
          authorization: token ? `Bearer ${token}` : '',
        },
      };
    });

    // Combine links
    this.client = new ApolloClient({
      link: ApolloLink.from([authLink, httpLink]),
      cache: new InMemoryCache(),
      defaultOptions: {
        query: {
          fetchPolicy: 'no-cache',
        },
      },
    });
  }

  /**
   * Get token service instance
   */
  getTokenService(): TokenRefreshService | undefined {
    return this.tokenService;
  }

  // Get authenticated user info
  async getMe() {
    const { data } = await this.client.query<MeQueryResponse>({
      query: gql`
        query Me {
          me {
            id
            name
            avatarURL
            bio
            profile { emailAddress timezone location }
          }
        }
      `,
    });
    return data!.me;
  }

  // Get Stream Chat config (token for real-time events)
  async getStreamConfig(): Promise<{ streamToken: string }> {
    const { data } = await this.client.query<{ config: { streamToken: string } }>({
      query: gql`
        query StreamConfig {
          config {
            streamToken
          }
        }
      `,
    });
    return data!.config;
  }

  // Get a single message by ID
  async getMessage(messageId: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query Message($messageId: ID!) {
          node(id: $messageId) {
            ... on Message {
              id
              streamID
              text
              createdAt
              updatedAt
              user {
                id
                name
              }
              threadID
              replyThreadID
              reactions {
                edges {
                  node { id type user { id name } }
                }
                totalCount
              }
              attachments {
                ... on File { id url name contentType }
              }
              quotedMessage {
                id
                text
                textPreview
                createdAt
                user { id name }
              }
            }
          }
        }
      `,
      variables: { messageId },
    });
    return data!.node;
  }

  // Get a specific thread with messages
  // Fetch a thread + a window of its messages.
  //
  // The messages connection is Relay-style: `first` returns the OLDEST N (paging
  // forward via after/endCursor), `last` returns the NEWEST N (paging backward via
  // before/startCursor). A limited read almost always wants the newest messages
  // (the tail of the conversation), so the default direction is 'newest' (last: N).
  // Either way the API returns edges in ascending createdAt order, so a reader sees
  // the most recent message at the bottom, like a chat.
  async getThread(
    threadId: string,
    messageCount: number = 100,
    opts: { direction?: 'newest' | 'oldest'; cursor?: string } = {}
  ) {
    const direction = opts.direction ?? 'newest';
    const useLast = direction === 'newest';
    const { data } = await this.client.query<ThreadQueryResponse>({
      query: gql`
        query Thread($threadId: ID!, $first: Int, $last: Int, $after: String, $before: String) {
          node(id: $threadId) {
            ... on Thread {
              id
              subject
              createdAt
              threadType
              parentThread { id subject }
              replyToMessage {
                id
                threadID
                textPreview
                createdAt
                user { id name }
              }
              recipients(first: 50) {
                edges {
                  node { id name }
                }
                totalCount
              }
              messages(first: $first, last: $last, after: $after, before: $before) {
                edges {
                  node {
                    id
                    text
                    createdAt
                    user {
                      id
                      name
                    }
                    threadID
                    replyThreadID
                    quotedMessage {
                      id
                      textPreview
                      createdAt
                      user { id name }
                    }
                    attachments {
                      ... on File { id url name contentType }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                  hasPreviousPage
                  startCursor
                }
              }
            }
          }
        }
      `,
      variables: {
        threadId,
        first: useLast ? null : messageCount,
        last: useLast ? messageCount : null,
        // forward paging consumes `after`; backward paging consumes `before`
        after: useLast ? null : opts.cursor ?? null,
        before: useLast ? opts.cursor ?? null : null,
      },
    });
    if (!data?.node) {
      throw new UsageError(
        `Thread not found, or you cannot see it: ${threadId}`,
        'Find thread IDs with `glue threads --search "<subject>"`.',
      );
    }
    return data.node;
  }

  // Get all messages from a thread (handles pagination automatically).
  // Pages backward from the newest message so partial failure still yields the
  // most recent messages; results are re-sorted ascending by createdAt at the end.
  async getAllThreadMessages(threadId: string): Promise<GlueMessage[]> {
    let messages: GlueMessage[] = [];
    let hasPreviousPage = true;
    let cursor: string | undefined;

    while (hasPreviousPage) {
      const thread = await this.getThread(threadId, 100, { direction: 'newest', cursor });
      const edges = thread.messages.edges;

      messages = messages.concat(edges.map((edge: any) => edge.node));

      hasPreviousPage = thread.messages.pageInfo.hasPreviousPage;
      cursor = thread.messages.pageInfo.startCursor;
    }

    // Pages arrive newest-window-first; sort ascending so callers get chronological order.
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return messages;
  }

  // Upload a file and return its Glue file ID
  async uploadFile(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const contentLength = buffer.length.toString();
    const contentMD5 = crypto.createHash('md5').update(buffer).digest('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.csv': 'text/csv',
      '.txt': 'text/plain', '.json': 'application/json',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.zip': 'application/zip',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Step 1: Get upload ticket (may return File directly if duplicate)
    const { data: ticketData } = await this.client.mutate<any>({
      mutation: gql`
        mutation UploadTicket($input: UploadTicketInput!) {
          uploadTicket(input: $input) {
            ... on File { id name }
            ... on UploadTicket {
              id
              url
              headers { name value }
              formData { name value }
            }
          }
        }
      `,
      variables: {
        input: { name, contentLength, contentMD5, contentType },
      },
    });

    const ticket = ticketData!.uploadTicket;

    // If API returned a File, it already exists — no upload needed
    if (ticket.__typename === 'File' || (!ticket.url && ticket.id && ticket.name)) {
      return ticket.id;
    }

    // Step 2: Upload file to presigned URL
    const headers: Record<string, string> = {};
    for (const h of ticket.headers || []) {
      headers[h.name] = h.value;
    }

    const uploadFailHint =
      `File upload to storage backend failed. ` +
      `This is almost always a CLI-side bug (binary FormData serialization, content-type mismatch, etc.) — ` +
      `NOT a server-side restriction on file types. PDFs, text, docs, and zips all upload fine when the CLI is healthy. ` +
      `Before suggesting workarounds (image-only, email, skip attachments), report the failure to the user verbatim and ask them to investigate the CLI.`;

    if (ticket.formData) {
      const form = new FormData();
      for (const entry of ticket.formData) {
        if (entry.value === '@file') {
          const u8 = new Uint8Array(buffer);
          form.append(entry.name, new File([u8], name, { type: contentType }));
        } else {
          form.append(entry.name, entry.value);
        }
      }
      const uploadRes = await request(ticket.url, { method: 'POST', headers, body: form }, { operation: 'File upload', timeoutMs: TRANSFER_TIMEOUT_MS });
      if (!uploadRes.ok) {
        throw new ApiError({ status: uploadRes.status, statusText: uploadRes.statusText, operation: 'File upload', safeDetail: safeDetail(await uploadRes.text()), hint: uploadFailHint });
      }
    } else {
      headers['Content-Type'] = contentType;
      const uploadRes = await request(ticket.url, { method: 'PUT', headers, body: buffer }, { operation: 'File upload', timeoutMs: TRANSFER_TIMEOUT_MS });
      if (!uploadRes.ok) {
        throw new ApiError({ status: uploadRes.status, statusText: uploadRes.statusText, operation: 'File upload', safeDetail: safeDetail(await uploadRes.text()), hint: uploadFailHint });
      }
    }

    // Step 3: Register the file
    const { data: fileData } = await this.client.mutate<any>({
      mutation: gql`
        mutation CreateFile($input: CreateFileInput!) {
          createFile(input: $input) {
            id
            name
          }
        }
      `,
      variables: {
        input: { uploadTicketID: ticket.id },
      },
    });

    return fileData!.createFile.id;
  }

  // Send a message to a thread
  async sendMessage(params: {
    threadId?: string;
    recipients?: string[];
    subject?: string;
    text: string;
    threadBy?: string;
    uniqueBy?: string;
    attachments?: string[];
    replyToMessageID?: string;
  }) {
    const { data } = await this.client.mutate<SendMessageResponse>({
      mutation: gql`
        mutation SendMessage($input: SendMessageInput!) {
          sendMessage(input: $input) {
            message {
              id
              text
              createdAt
              user {
                id
                name
              }
              threadID
            }
            thread {
              id
              subject
              createdAt
              replyToMessage { id threadID }
            }
          }
        }
      `,
      variables: {
        input: {
          threadID: params.threadId,
          thread: params.recipients ? {
            recipients: params.recipients,
            subject: params.subject,
            threadBy: params.threadBy,
            replyToMessageID: params.replyToMessageID,
          } : undefined,
          message: {
            text: params.text,
            uniqueBy: params.uniqueBy,
            attachments: params.attachments || [],
          },
        },
      },
    });
    return data!.sendMessage;
  }

  // Delete a message. Glue returns a scalar Boolean, so this mutation has no selection set.
  async deleteMessage(messageId: string): Promise<boolean> {
    const { data } = await this.client.mutate<DeleteMessageResponse>({
      mutation: gql`
        mutation DeleteMessage($id: ID!) {
          deleteMessage(id: $id)
        }
      `,
      variables: { id: messageId },
    });
    return data!.deleteMessage;
  }

  // Update an existing message. Glue replaces the message's attachments with the list sent here, so
  // an empty list strips its files. With no list given, the message keeps the files it has.
  async updateMessage(messageId: string, text: string, attachments?: string[]) {
    const keep = attachments ?? ((await this.getMessage(messageId))?.attachments || [])
      .map((file: any) => file?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation UpdateMessage($id: ID!, $input: UpdateMessageInput!) {
          updateMessage(id: $id, input: $input) {
            id
            text
            createdAt
            user {
              id
              name
            }
            threadID
          }
        }
      `,
      variables: {
        id: messageId,
        input: {
          text,
          attachments: keep,
        },
      },
    });
    return data!.updateMessage;
  }

  // Helper: Get recent threads I'm involved in
  async getMyRecentThreads(count: number = 20) {
    const result = await this.searchThreads({ order: 'lastMessage', last: count });
    return result.edges.map((edge: any) => edge.node);
  }

  // Helper: Get messages I sent in a thread
  async getMyMessagesInThread(threadId: string): Promise<GlueMessage[]> {
    const messages = await this.getAllThreadMessages(threadId);
    return messages.filter(msg => msg.user.id === config.glue.userId);
  }

  // Helper: Get messages from others in a thread
  async getOthersMessagesInThread(threadId: string): Promise<GlueMessage[]> {
    const messages = await this.getAllThreadMessages(threadId);
    return messages.filter(msg => msg.user.id !== config.glue.userId);
  }

  // Get groups (paginated)
  async getGroups(first: number = 50, after?: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query Groups($first: Int!, $after: String) {
          groups(first: $first, after: $after) {
            edges {
              node {
                id
                name
                description
                memberCount
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
            totalCount
          }
        }
      `,
      variables: {
        first,
        after,
      },
    });
    return data!.groups;
  }

  // Get all groups (handles pagination)
  async getAllGroups(): Promise<Array<{ id: string; name: string }>> {
    let allGroups: Array<{ id: string; name: string }> = [];
    let hasNextPage = true;
    let after: string | undefined;

    while (hasNextPage) {
      const result = await this.getGroups(100, after);
      allGroups = allGroups.concat(result.edges.map((e: any) => e.node));
      hasNextPage = result.pageInfo.hasNextPage;
      after = result.pageInfo.endCursor;
    }

    return allGroups;
  }

  // Search threads using server-side filters
  async searchThreads(opts: {
    matchMessages?: string;
    match?: string;
    recipientId?: string;
    excludeChats?: boolean;
    order?: 'created' | 'lastMessage' | 'unread';
    last?: number;
    before?: string;
  } = {}) {
    const { data } = await this.client.query<any>({
      query: gql`
        query SearchThreads(
          $filter: ThreadsFilter,
          $order: ThreadsOrder,
          $last: Int,
          $before: String
        ) {
          threads(filter: $filter, order: $order, last: $last, before: $before) {
            edges {
              node {
                id
                subject
                createdAt
                threadType
                closedAt
                lastMessage {
                  id
                  text
                  textPreview
                  createdAt
                  user { id name }
                }
                firstMessage {
                  id
                  textPreview
                  createdAt
                  user { id name }
                }
                recentMessagesUsers { id name }
                recipients(first: 20) {
                  edges {
                    node { id name }
                  }
                  totalCount
                }
              }
              cursor
              recipientRole
            }
            matchedMessages {
              edges {
                node {
                  id
                  text
                  textPreview
                  createdAt
                  threadId
                  user { id name }
                }
              }
              totalCount
            }
            totalCount
            pageInfo {
              hasPreviousPage
              startCursor
            }
          }
        }
      `,
      variables: {
        filter: {
          match: opts.match || undefined,
          matchMessages: opts.matchMessages || undefined,
          recipientId: opts.recipientId || undefined,
          excludeChats: opts.excludeChats,
        },
        order: opts.order || 'lastMessage',
        last: opts.last || 20,
        before: opts.before || undefined,
      },
    });
    return data!.threads;
  }

  // Search groups by name (server-side via workspace)
  async searchGroups(match: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query SearchGroups($filter: GroupsFilter, $order: GroupsOrder, $first: Int) {
          workspace {
            groups(filter: $filter, order: $order, first: $first) {
              edges {
                node {
                  ... on Group {
                    id
                    name
                    description
                    memberCount
                  }
                  ... on GroupPreview {
                    id
                    name
                    description
                    memberCount
                  }
                }
              }
              totalCount
            }
          }
        }
      `,
      variables: {
        filter: { match, member: true },
        order: 'interaction',
        first: 50,
      },
    });
    return data!.workspace.groups;
  }

  // Add recipients to a thread
  async addThreadRecipients(threadId: string, recipientIds: string[]) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation AddThreadRecipients($id: ID!, $recipients: [RecipientRoleInput!]!) {
          addThreadRecipients(id: $id, recipients: $recipients) {
            id
            subject
            recipients(first: 50) {
              edges { node { id name } }
              totalCount
            }
          }
        }
      `,
      variables: {
        id: threadId,
        recipients: recipientIds.map(id => ({ recipient: id })),
      },
    });
    return data!.addThreadRecipients;
  }

  // Remove recipients from a thread
  async removeThreadRecipients(threadId: string, recipientIds: string[]) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation RemoveThreadRecipients($id: ID!, $recipientIDs: [ID!]!) {
          removeThreadRecipients(id: $id, recipientIDs: $recipientIDs) {
            id
            subject
            recipients(first: 50) {
              edges { node { id name } }
              totalCount
            }
          }
        }
      `,
      variables: { id: threadId, recipientIDs: recipientIds },
    });
    return data!.removeThreadRecipients;
  }

  // Update a thread (subject, recipients, visibility)
  async updateThread(threadId: string, input: { subject?: string; recipients?: string[]; isPublic?: boolean }) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
          updateThread(id: $id, input: $input) {
            id
            subject
            recipients(first: 50) {
              edges { node { id name } }
              totalCount
            }
          }
        }
      `,
      variables: { id: threadId, input },
    });
    return data!.updateThread;
  }

  // Delete a thread
  async deleteThread(threadId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation DeleteThread($id: ID!) {
          deleteThread(id: $id)
        }
      `,
      variables: { id: threadId },
    });
    return data!.deleteThread;
  }

  // Close a thread
  async closeThread(threadId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation CloseThread($id: ID!) {
          closeThread(id: $id) {
            id
            subject
            closedAt
          }
        }
      `,
      variables: { id: threadId },
    });
    return data!.closeThread;
  }

  // Reopen a thread
  async reopenThread(threadId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation ReopenThread($id: ID!) {
          reopenThread(id: $id) {
            id
            subject
            closedAt
          }
        }
      `,
      variables: { id: threadId },
    });
    return data!.reopenThread;
  }

  // Get members of a group (paginated)
  async getGroupMembers(groupId: string, first: number = 100, after?: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query GroupMembers($id: ID!, $first: Int!, $after: String) {
          node(id: $id) {
            ... on Group {
              id
              name
              members(first: $first, after: $after) {
                edges {
                  node { id name }
                  role
                }
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
      variables: { id: groupId, first, after },
    });
    return data!.node;
  }

  // Get all members of a group (handles pagination)
  async getAllGroupMembers(groupId: string): Promise<{ group: { id: string; name: string }; members: Array<{ id: string; name: string; role: string }>; totalCount: number }> {
    let members: Array<{ id: string; name: string; role: string }> = [];
    let hasNextPage = true;
    let after: string | undefined;
    let groupInfo = { id: '', name: '' };

    while (hasNextPage) {
      const result = await this.getGroupMembers(groupId, 100, after);
      groupInfo = { id: result.id, name: result.name };
      members = members.concat(
        result.members.edges.map((e: any) => ({ id: e.node.id, name: e.node.name, role: e.role || 'member' }))
      );
      hasNextPage = result.members.pageInfo.hasNextPage;
      after = result.members.pageInfo.endCursor;
    }

    return { group: groupInfo, members, totalCount: members.length };
  }

  // Add members to a group
  async addGroupMembers(groupId: string, memberIds: string[]) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation AddGroupMembers($id: ID!, $members: [MemberRoleInput!]!) {
          addGroupMembers(id: $id, members: $members) {
            id
            name
          }
        }
      `,
      variables: {
        id: groupId,
        members: memberIds.map(id => ({ member: id })),
      },
    });
    return data!.addGroupMembers;
  }

  // Remove members from a group
  async removeGroupMembers(groupId: string, memberIds: string[]) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation RemoveGroupMembers($id: ID!, $memberIDs: [ID!]!) {
          removeGroupMembers(id: $id, memberIDs: $memberIDs) {
            id
            name
          }
        }
      `,
      variables: { id: groupId, memberIDs: memberIds },
    });
    return data!.removeGroupMembers;
  }

  // Create a group
  async createGroup(name: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation CreateGroup($input: CreateGroupInput!) {
          createGroup(input: $input) {
            id
            name
          }
        }
      `,
      variables: { input: { name } },
    });
    return data!.createGroup;
  }

  // Update a group
  async updateGroup(groupId: string, input: { name?: string; isPublic?: boolean }) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation UpdateGroup($id: ID!, $input: UpdateGroupInput!) {
          updateGroup(id: $id, input: $input) {
            id
            name
          }
        }
      `,
      variables: { id: groupId, input },
    });
    return data!.updateGroup;
  }

  // Delete a group
  async deleteGroup(groupId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation DeleteGroup($id: ID!) {
          deleteGroup(id: $id)
        }
      `,
      variables: { id: groupId },
    });
    return data!.deleteGroup;
  }

  // Join a group
  async joinGroup(groupId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation JoinGroup($id: ID!) {
          joinGroup(id: $id) {
            id
            name
          }
        }
      `,
      variables: { id: groupId },
    });
    return data!.joinGroup;
  }

  // Leave a group
  async leaveGroup(groupId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation LeaveGroup($id: ID!) {
          leaveGroup(id: $id)
        }
      `,
      variables: { id: groupId },
    });
    return data!.leaveGroup;
  }

  // Pin a message
  async pinMessage(messageId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation PinMessage($input: MessagePinInput!) {
          pinMessage(input: $input) {
            id
            createdAt
            message { id }
          }
        }
      `,
      variables: { input: { messageID: messageId } },
    });
    return data!.pinMessage;
  }

  // Unpin a message
  async unpinMessage(messageId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation UnpinMessage($input: MessagePinInput!) {
          unpinMessage(input: $input)
        }
      `,
      variables: { input: { messageID: messageId } },
    });
    return data!.unpinMessage;
  }

  // Mailbox counts — unread inbox, mentions, and unseen activity feed.
  // Each is a `threads(filter:{mailbox:…})` count (mirrors the web app's MailboxCounts).
  async getMailboxCounts() {
    const { data } = await this.client.query<any>({
      query: gql`
        query MailboxCounts {
          unreadInbox: threads(filter: { mailbox: unread }) { totalCount }
          mentionedThreads: threads(filter: { mailbox: mentioned }) { totalCount }
          unseenThreadsFeed: threads(filter: { mailbox: activity, neverSeen: true, excludePersistentChats: true }) { totalCount }
        }
      `,
    });
    return {
      unreadInbox: data.unreadInbox?.totalCount ?? 0,
      mentioned: data.mentionedThreads?.totalCount ?? 0,
      unseenActivity: data.unseenThreadsFeed?.totalCount ?? 0,
    };
  }

  // Notification / activity feed. feedType: 'all' | 'direct' | 'mentions' (server enum).
  async getNotifications(feedType: string = 'all') {
    const { data } = await this.client.query<any>({
      query: gql`
        query Notifications($filter: NotificationsFilter) {
          notifications(filter: $filter) {
            totalCount
            unreadCount
            unseenCount
            edges {
              isRead
              isSeen
              node {
                id
                text
                verb
                activityCount
                actorCount
                activities { time verb actor { id name } }
              }
            }
          }
        }
      `,
      variables: { filter: { feedType } },
    });
    return data.notifications;
  }

  // Saved (unsent) drafts.
  async getDrafts(last: number = 50) {
    const { data } = await this.client.query<any>({
      query: gql`
        query DraftList($last: Int) {
          drafts(last: $last) {
            totalCount
            edges {
              node {
                id
                subject
                message { textPreview }
                recipients { id name }
                updatedAt
              }
            }
          }
        }
      `,
      variables: { last },
    });
    return data.drafts;
  }

  // Persistent chats (running group chats or 1:1 DMs). chatType: 'group' | 'user'.
  async getPersistentChats(chatType: 'group' | 'user' = 'group', last: number = 30, order: string = 'unread') {
    const { data } = await this.client.query<any>({
      query: gql`
        query PersistentChats($chatType: ChatType, $last: Int, $order: ThreadsOrder) {
          persistentChats(filter: { chatType: $chatType }, last: $last, order: $order) {
            totalCount
            edges {
              node {
                id
                subject
                threadType
                lastMessage { textPreview createdAt user { id name } }
              }
            }
          }
        }
      `,
      variables: { chatType, last, order },
    });
    return data.persistentChats;
  }

  // Workspace custom emojis (name → image). Useful for resolving `glue react` names.
  async getCustomEmojis(first: number = 300) {
    const { data } = await this.client.query<any>({
      query: gql`
        query CustomEmojisSimple($first: Int) {
          customEmojis(first: $first) {
            edges { node { id name imageUrl } }
          }
        }
      `,
      variables: { first },
    });
    return (data.customEmojis?.edges || []).map((e: any) => e.node);
  }

  // Fetch a single draft by ID (full message text + recipient IDs, for re-send).
  async getDraft(draftId: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query FetchDraft($id: ID!) {
          node(id: $id) {
            ... on Draft {
              id
              subject
              message { text attachments { ... on File { id } } }
              recipients { id name }
            }
          }
        }
      `,
      variables: { id: draftId },
    });
    return data.node;
  }

  // Save (create or update) a draft. Pass draftId to update an existing one.
  async saveDraft(params: { draftId?: string; recipients: string[]; subject?: string; text: string; attachments?: string[]; replyToMessageID?: string }) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation SaveDraft($id: ID, $input: SaveDraftInput!) {
          saveDraft(id: $id, input: $input) {
            id
            subject
            message { textPreview }
            recipients { id name }
          }
        }
      `,
      variables: {
        id: params.draftId,
        input: {
          recipients: params.recipients,
          subject: params.subject,
          replyToMessageID: params.replyToMessageID,
          message: { text: params.text, attachments: params.attachments || [] },
        },
      },
    });
    return data.saveDraft;
  }

  // Send a draft (creates the thread/message and consumes the draft).
  async sendDraft(params: { draftId: string; recipients: string[]; subject?: string; text: string; attachments?: string[]; replyToMessageID?: string }) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation SendDraft($id: ID, $input: SaveDraftInput!) {
          sendDraft(id: $id, input: $input) {
            id
            subject
          }
        }
      `,
      variables: {
        id: params.draftId,
        input: {
          recipients: params.recipients,
          subject: params.subject,
          replyToMessageID: params.replyToMessageID,
          message: { text: params.text, attachments: params.attachments || [] },
        },
      },
    });
    return data.sendDraft;
  }

  // A thread's recipients with the subscription each one holds on it (inbox,
  // activity, …). Pages through the whole list, not only the first 50.
  async getThreadRecipientRoles(threadId: string): Promise<Array<{ id: string; name: string; subscription: string | null }>> {
    const roles: Array<{ id: string; name: string; subscription: string | null }> = [];
    let after: string | null = null;
    for (;;) {
      const res: { data: any } = await this.client.query<any>({
        query: gql`
          query FetchThreadRecipients($id: ID!, $after: String, $first: Int) {
            node(id: $id) {
              ... on Thread {
                recipients(after: $after, first: $first) {
                  edges {
                    node { id name }
                    subscription
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }
        `,
        variables: { id: threadId, after, first: 100 },
      });
      const conn: any = res.data?.node?.recipients;
      if (!conn) break;
      for (const e of conn.edges) roles.push({ id: e.node.id, name: e.node.name, subscription: e.subscription ?? null });
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return roles;
  }

  // Create a subthread: a new thread inside another thread — the web
  // composer's "Thread" button. The web app does this with sendDraft (no draft ID) and lists the
  // PARENT THREAD ITSELF as a recipient. The server then sets the new thread's
  // parentThread. No anchor message is involved (replyToMessage stays null).
  async createSubthread(params: {
    parentThreadId: string;
    recipientRoles: Array<{ recipient: string; subscription: string }>;
    subject?: string;
    text: string;
    attachments?: string[];
  }) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation SendDraft($id: ID, $input: SaveDraftInput!) {
          sendDraft(id: $id, input: $input) {
            id
            subject
            createdAt
            parentThread { id subject }
            firstMessage { id text createdAt user { id name } threadID }
          }
        }
      `,
      variables: {
        id: null,
        input: {
          subject: params.subject,
          message: { text: params.text, attachments: params.attachments || [] },
          recipientRoles: [
            { recipient: params.parentThreadId, subscription: 'inbox' },
            ...params.recipientRoles.filter(r => r.recipient !== params.parentThreadId),
          ],
        },
      },
    });
    return data.sendDraft;
  }

  // Delete a draft.
  async deleteDraft(draftId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation DeleteDraft($id: ID!) { deleteDraft(id: $id) }
      `,
      variables: { id: draftId },
    });
    return data.deleteDraft;
  }

  // Mark thread edges read/unread. readInput shape: { isRead: Boolean } (see MarkThreadEdgeReadInput).
  async markThreadsRead(threadIds: string[], isRead: boolean = true) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation MarkThreadEdges($ids: [ID!]!, $read: MarkThreadEdgeReadInput) {
          markThreadEdges(ids: $ids, read: $read) {
            id
            isRead
          }
        }
      `,
      variables: { ids: threadIds, read: { isRead } },
    });
    return data.markThreadEdges;
  }

  // List a thread's pinned resources (files, links, messages, or threads pinned to it).
  async getPinnedResources(threadId: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query ThreadPinnedResources($threadId: ID!) {
          node(id: $threadId) {
            id
            ... on Thread {
              pinnedResources(first: 30) {
                edges {
                  node {
                    ... on PinnedResource {
                      id
                      title
                      createdAt
                      resource {
                        ... on File { id name url }
                        ... on MessagePreview { id }
                        ... on ThreadPreview { id subject }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { threadId },
    });
    return (data.node?.pinnedResources?.edges || []).map((e: any) => e.node);
  }

  // Pin a resource (message/file/thread ID) to a thread. Input is {threadId, resourceId}.
  async pinResource(threadId: string, resourceId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation PinResource($input: PinResourceInput!) {
          pinResource(input: $input) {
            pinnedResource { ... on PinnedResource { id } }
          }
        }
      `,
      variables: { input: { threadId, resourceId } },
    });
    return data.pinResource?.pinnedResource;
  }

  // Unpin a pinned resource by its pir_ ID.
  async unpinResource(pinnedResourceId: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation UnpinResource($id: ID!) {
          unpinResource(id: $id) { success }
        }
      `,
      variables: { id: pinnedResourceId },
    });
    return data.unpinResource?.success;
  }

  // Set or clear a personal reminder on a thread (remindAt ISO string, or null to clear).
  async setThreadReminder(threadId: string, remindAt: string | null) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation MarkThreadEdges($ids: [ID!]!, $reminder: MarkThreadEdgeReminderInput) {
          markThreadEdges(ids: $ids, reminder: $reminder) { id remindAt }
        }
      `,
      variables: { ids: [threadId], reminder: { remindAt } },
    });
    return data.markThreadEdges;
  }

  // Start a Glue AI session anchored to a context thread, with an initial prompt.
  // Returns the session id + the sessionThread where the agent replies (read it like any thread).
  async createAISession(contextThreadID: string, text: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation CreateAIThreadSession($input: AISessionInput!) {
          createAISession(input: $input) {
            id
            agentUserId
            sessionThread { id subject }
          }
        }
      `,
      variables: { input: { contextThreadID, message: { text, attachments: [] } } },
    });
    return data.createAISession;
  }

  // Cancel an AI session by its ais_ ID.
  async cancelAISession(sessionID: string) {
    const { data } = await this.client.mutate<any>({
      mutation: gql`
        mutation CancelAIThreadSession($sessionID: ID!) { cancelAISession(sessionID: $sessionID) }
      `,
      variables: { sessionID },
    });
    return data.cancelAISession;
  }

  // Search workspace members by name
  async searchMembers(match: string) {
    const { data } = await this.client.query<any>({
      query: gql`
        query SearchMembers($filter: MembersFilter, $first: Int) {
          workspace {
            members(filter: $filter, first: $first) {
              edges {
                node { id name bio avatarURL profile { emailAddress timezone location } }
              }
              totalCount
            }
          }
        }
      `,
      variables: {
        filter: { match },
        first: 20,
      },
    });
    return data!.workspace.members;
  }
}
