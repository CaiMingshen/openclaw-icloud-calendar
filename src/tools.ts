/**
 * The agent-facing tools.
 *
 * Registration only: each tool declares the schema a model sees and delegates
 * to {@link ICloudCalendarService}. Argument types, defaults and bounds live in
 * the service, because a schema cannot express "a window no longer than the
 * config allows" or "a confirm count that must equal what actually matched".
 *
 * Every tool forwards the abort signal, so a cancelled call aborts the in-flight
 * CalDAV request instead of leaving it to finish.
 */

import { Type, type Static } from 'typebox';
import type { ICloudCalendarService } from './service.js';

export const TOOL_NAMES = [
  'calendar_status',
  'calendar_list_calendars',
  'calendar_list_events',
  'calendar_create_event',
  'calendar_delete_events',
] as const;

/** Canonical tool result: lossless JSON rendered as text for the model. */
const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  details: JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
});

const calendarStatusParams = Type.Object({}, { additionalProperties: false });

const listCalendarsParams = Type.Object(
  {
    refresh: Type.Optional(
      Type.Boolean({
        description:
          'Set true to bypass the listing cache and ask iCloud again, for example right after creating a calendar elsewhere.',
      }),
    ),
  },
  { additionalProperties: false },
);

const listEventsParams = Type.Object(
  {
    start: Type.String({
      description: 'Inclusive start of the window: RFC3339 with offset, or YYYY-MM-DD for an all-day boundary.',
    }),
    end: Type.String({
      description: 'Exclusive end of the window, in the same notation as start.',
    }),
    calendars: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Calendar names or collection URLs to read. Omit to use every event calendar the account exposes.',
      }),
    ),
    limit: Type.Optional(Type.Integer({ description: 'Maximum occurrences to return, after expansion.' })),
  },
  { additionalProperties: false },
);

const createEventParams = Type.Object(
  {
    summary: Type.String({ description: 'Event title.' }),
    start: Type.String({
      description: 'RFC3339 instant with offset, or YYYY-MM-DD for an all-day event.',
    }),
    end: Type.String({
      description: 'Exclusive end in the same notation as start. Two dates means all-day; two timestamps means timed.',
    }),
    calendar: Type.Optional(
      Type.String({ description: 'Calendar name or collection URL. Required when more than one qualifies.' }),
    ),
    location: Type.Optional(Type.String({ description: 'Free-text location.' })),
    description: Type.Optional(Type.String({ description: 'Longer notes.' })),
    timeZone: Type.Optional(Type.String({ description: 'IANA time zone, for example Asia/Shanghai.' })),
  },
  { additionalProperties: false },
);

const deleteEventsParams = Type.Object(
  {
    start: Type.String({ description: 'Mandatory inclusive start of the scan window.' }),
    end: Type.String({ description: 'Mandatory exclusive end of the scan window.' }),
    uid: Type.Optional(
      Type.String({
        description: 'Series UID copied from calendar_list_events. Preferred way to name the target.',
      }),
    ),
    summaryEquals: Type.Optional(
      Type.String({
        description: 'Complete, exact, case-sensitive title. Substring and fuzzy matches are refused on purpose.',
      }),
    ),
    calendar: Type.Optional(Type.String({ description: 'Restrict the scan to one calendar name or URL.' })),
    dryRun: Type.Optional(
      Type.Boolean({
        description: 'Defaults to true: report what would be removed without removing it. Set false only to actually delete.',
      }),
    ),
    confirmCount: Type.Optional(
      Type.Integer({
        description: 'Required when dryRun is false: must equal the number of matched objects exactly.',
      }),
    ),
  },
  { additionalProperties: false },
);

/** One tool definition, shaped for the OpenClaw tool registry. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: Record<string, unknown>, context: ToolExecuteContext): Promise<unknown>;
}

/** Builds every tool bound to one service instance. */
export interface ToolExecuteContext {
  service: ICloudCalendarService;
  signal?: AbortSignal;
}

/** Builds every tool; the service is supplied per call by the plugin entry. */
export function buildTools(): ToolDefinition[] {
  return [
    {
      name: 'calendar_status',
      description:
        'Report whether iCloud calendar access is configured, where the password came from, and whether a connection has succeeded. ' +
        'Call this first when another calendar tool reports a configuration or authentication problem, and after storing or changing credentials. ' +
        'It never returns the app-specific password: it reports only which source holds one.',
      parameters: calendarStatusParams,
      execute: async (_args, context) => {
        context.signal?.throwIfAborted();
        return jsonResult(await context.service.status());
      },
    },
    {
      name: 'calendar_list_calendars',
      description:
        'List the iCloud calendars this account exposes, with each collection URL, display name, colour, time zone and component types. ' +
        'Use the returned name or URL as the "calendars" argument of calendar_list_events or the "calendar" argument of calendar_create_event. ' +
        'iCloud Reminders lists appear here with supportsEvents=false and cannot hold events.',
      parameters: listCalendarsParams,
      execute: async (args, context) =>
        jsonResult(await context.service.listCalendars({ force: args.refresh === true, signal: context.signal })),
    },
    {
      name: 'calendar_list_events',
      description:
        'Read calendar events inside a time window. Recurring series are expanded into individual occurrences and cancelled instances are skipped. ' +
        'Each result carries the uid and object URL needed by calendar_create_event and calendar_delete_events. ' +
        'The window is mandatory and bounded by the configured maximum.',
      parameters: listEventsParams,
      execute: async (args: Static<typeof listEventsParams>, context) =>
        jsonResult(
          await context.service.listEvents(
            {
              start: args.start,
              end: args.end,
              ...(args.calendars === undefined ? {} : { calendars: args.calendars }),
              ...(args.limit === undefined ? {} : { limit: args.limit }),
            },
            context.signal,
          ),
        ),
    },
    {
      name: 'calendar_create_event',
      description:
        'Create one event. Pass two dates (YYYY-MM-DD) for an all-day event, or two timestamps with an offset for a timed one; end is exclusive. ' +
        'Requires writes to be enabled. Returns the created object URL and uid.',
      parameters: createEventParams,
      execute: async (args: Static<typeof createEventParams>, context) =>
        jsonResult(
          await context.service.createEvent(
            {
              summary: args.summary,
              start: args.start,
              end: args.end,
              ...(args.calendar === undefined ? {} : { calendar: args.calendar }),
              ...(args.location === undefined ? {} : { location: args.location }),
              ...(args.description === undefined ? {} : { description: args.description }),
              ...(args.timeZone === undefined ? {} : { timeZone: args.timeZone }),
            },
            context.signal,
          ),
        ),
    },
    {
      name: 'calendar_delete_events',
      description:
        'Delete events. Dry-run by default. Real deletion requires deletes to be enabled, the target named exactly (uid or complete title), ' +
        'dryRun set to false, and confirmCount equal to the number of matched objects. Deleting an occurrence of a recurring series removes the whole series.',
      parameters: deleteEventsParams,
      execute: async (args: Static<typeof deleteEventsParams>, context) =>
        jsonResult(
          await context.service.deleteEvents(
            {
              start: args.start,
              end: args.end,
              ...(args.uid === undefined ? {} : { uid: args.uid }),
              ...(args.summaryEquals === undefined ? {} : { summaryEquals: args.summaryEquals }),
              ...(args.calendar === undefined ? {} : { calendar: args.calendar }),
              ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
              ...(args.confirmCount === undefined ? {} : { confirmCount: args.confirmCount }),
            },
            context.signal,
          ),
        ),
    },
  ];
}
