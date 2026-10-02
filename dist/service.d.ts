/**
 * The iCloud Calendar service.
 *
 * Owns everything with a lifetime: the connected client, the calendar cache,
 * the last failure. This is the OpenClaw port of the DSH `icloudCalendar`
 * service: same behaviour, no cordis `Service` base class.
 *
 * The delete guard deliberately lives in `policy.ts` so the service, the CLI
 * and any future caller share one implementation of it.
 */
import { ConfigSchema, describeConfiguration, type Config as CalendarConfig } from './config.js';
import { isCalendarError } from './errors.js';
import type { CalendarStatus, CalendarSummary, CreateEventRequest, CreatedEvent, DeleteEventsRequest, DeleteEventsResult, ListEventsResult } from './types.js';
/** Options accepted by {@link ICloudCalendarService.listEvents}. */
export interface ListEventsOptions {
    start: string;
    end: string;
    calendars?: readonly string[];
    limit?: number;
    onProgress?: (message: string) => void;
}
/**
 * iCloud Calendar over CalDAV.
 *
 * Holds one client: connecting costs seconds on iCloud, so it is worth keeping.
 * A failed connection is never cached, so exporting the app-specific password
 * after the Gateway started is picked up by the next call instead of requiring
 * a restart.
 */
export declare class ICloudCalendarService {
    private readonly config;
    private readonly store;
    private client;
    private connecting;
    private lastError;
    private secretSource;
    private calendarCount;
    constructor(config: CalendarConfig);
    /** The configuration in force, with no secret material in it. */
    get configuration(): ReturnType<typeof describeConfiguration>;
    /** Connects at most once per healthy client; failures are not remembered. */
    private connect;
    /** Configuration, credential provenance and connectivity, with no secret. */
    status(): Promise<CalendarStatus>;
    /** Lists calendars, using the cache unless `force` is set. */
    listCalendars(options?: {
        force?: boolean;
        signal?: AbortSignal;
    }): Promise<CalendarSummary[]>;
    /** Resolves requested calendar names against the account's collections. */
    selectCalendars(requested: readonly string[] | undefined, signal?: AbortSignal): Promise<CalendarSummary[]>;
    /** Reads events in a window, expanding recurring series. */
    listEvents(options: ListEventsOptions, signal?: AbortSignal): Promise<ListEventsResult>;
    /** Creates one event. Refused entirely when writes are disabled. */
    createEvent(request: CreateEventRequest, signal?: AbortSignal): Promise<CreatedEvent>;
    /** Deletes events through the shared guard in `policy.ts`. */
    deleteEvents(request: DeleteEventsRequest, signal?: AbortSignal): Promise<DeleteEventsResult>;
}
export { ConfigSchema };
export type { CalendarConfig };
export { isCalendarError };
//# sourceMappingURL=service.d.ts.map