// Glue API Types

export interface GlueUser {
  id: string; // usr_xxx format
  name: string;
  avatarURL?: string;
  bio?: string;
  profile?: {
    emailAddress?: string;
    timezone?: string;
    location?: string;
  };
}

export interface GlueThread {
  id: string; // thr_xxx format
  subject?: string;
  createdAt: string;
  lastMessageAt?: string;
}

export interface GlueQuotedMessage {
  id: string;
  text?: string;
  textPreview?: string;
  createdAt: string;
  user: { id: string; name: string };
}

export interface GlueAttachment {
  id: string; // fil_xxx format
  url?: string;
  name?: string;
  contentType?: string;
}

export interface GlueMessage {
  id: string; // msg_xxx format
  text: string;
  createdAt: string;
  user: GlueUser;
  threadID: string;
  replyThreadID?: string | null; // branch thread started off this message, if any
  quotedMessage?: GlueQuotedMessage | null;
  attachments?: GlueAttachment[]; // files attached to the message (selected by getMessage / getThread)
}

export interface GlueGroup {
  id: string; // grp_xxx format
  name: string;
  description?: string;
}

// GraphQL Response Types

export interface SendMessageResponse {
  sendMessage: {
    message: GlueMessage;
    thread: GlueThread;
  };
}

export interface DeleteMessageResponse {
  deleteMessage: boolean;
}

export interface ThreadQueryResponse {
  node: GlueThread & {
    threadType?: string;
    parentThread?: { id: string; subject?: string | null } | null;
    replyToMessage?: {
      id: string;
      threadID: string;
      textPreview?: string;
      createdAt: string;
      user: { id: string; name: string };
    } | null;
    recipients: {
      edges: Array<{
        node: { id: string; name: string };
      }>;
      totalCount: number;
    };
    messages: {
      edges: Array<{
        node: GlueMessage;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor?: string;
        hasPreviousPage: boolean;
        startCursor?: string;
      };
    };
  };
}

export interface MeQueryResponse {
  me: GlueUser;
}
