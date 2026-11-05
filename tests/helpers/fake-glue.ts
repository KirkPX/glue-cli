import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

export interface Call {
  operationName: string;
  variables: Record<string, any>;
  authorization?: string;
}

type Handler = (variables: Record<string, any>) => unknown;

/** A local GraphQL server that answers by operation name and records each call. */
export class FakeGlue {
  readonly calls: Call[] = [];
  private server?: Server;

  constructor(private readonly handlers: Record<string, Handler>) {}

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/graphql`;
  }

  callsTo(operationName: string): Call[] {
    return this.calls.filter((call) => call.operationName === operationName);
  }

  start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const { operationName, variables } = JSON.parse(raw);
        this.calls.push({ operationName, variables, authorization: req.headers.authorization });
        const handler = this.handlers[operationName];
        const body = handler
          ? { data: handler(variables) }
          : { errors: [{ message: `fake server has no handler for ${operationName}` }] };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      });
    });
    return new Promise((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve(this)));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }
}

export const message = (id: string, text: string, attachments: unknown[] = []) => ({
  __typename: 'Message',
  id,
  streamID: `stream_${id}`,
  text,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  threadID: 'thr_one',
  replyThreadID: null,
  user: { __typename: 'User', id: 'usr_test', name: 'Test User' },
  reactions: { __typename: 'ReactionConnection', edges: [], totalCount: 0 },
  attachments,
});
