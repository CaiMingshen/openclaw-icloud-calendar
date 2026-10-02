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

import { ICloudCalendarClient } from './client.js';
import {
  ConfigSchema,
  describeConfiguration,
  resolveCredentials,
  storeFor,
  type Config as CalendarConfig,
} from './config.js';
import type { SecureStore } from './credentials.js';
import { CalendarError, isCalendarError, toCalendarError } from './errors.js';
import { resolveWindow } from './ical.js';
import { runDelete } from './policy.js';
import type {
  CalendarStatus,
  CalendarSummary,
  CreateEventRequest,
  CreatedEvent,
  DeleteEventsRequest,
  DeleteEventsResult,
  ListEventsResult,
} from './types.js';

const DAY_MS = 86_400_000;

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
export class ICloudCalendarService {
  private readonly store: SecureStore;
  private client: ICloudCalendarClient | undefined;
  private connecting: Promise<ICloudCalendarClient> | undefined;
  private lastError: { code: string; message: string } | null = null;
  private secretSource: string | null = null;
  private calendarCount: number | null = null;

  constructor(private readonly config: CalendarConfig) {
    this.store = storeFor(config);
  }

  /** The configuration in force, with no secret material in it. */
  get configuration(): ReturnType<typeof describeConfiguration> {
    return describeConfiguration(this.config, this.store);
  }

  /** Connects at most once per healthy client; failures are not remembered. */
  private async connect(signal?: AbortSignal): Promise<ICloudCalendarClient> {
    if (this.client !== undefined) return this.client;
    if (this.connecting === undefined) {
      this.connecting = (async () => {
        try {
          const resolved = await resolveCredentials(this.config, this.store);
          this.secretSource = resolved.source;
          const client = await ICloudCalendarClient.connect(
            {
              credentials: resolved.credentials,
              timeoutMs: this.config.timeoutMs,
              retries: this.config.retries,
              proxyUrl: this.config.proxyUrl,
              maxOccurrencesPerSeries: this.config.maxOccurrencesPerSeries,
            },
            signal,
          );
          this.client = client;
          this.lastError = null;
          return client;
        } catch (error) {
          const calendarError = toCalendarError(error);
          this.lastError = { code: calendarError.code, message: calendarError.message };
          throw calendarError;
        } finally {
          this.connecting = undefined;
        }
      })();
    }
    return await this.connecting;
  }

  /** Configuration, credential provenance and connectivity, with no secret. */
  async status(): Promise<CalendarStatus> {
    const description = this.configuration;
    let configured = false;
    if (description.account !== null) {
      try {
        const resolved = await resolveCredentials(this.config, this.store);
        configured = resolved.credentials.account !== '';
        this.secretSource = resolved.source;
        if (this.lastError === null) {
          try {
            const client = await this.connect();
            this.calendarCount = (
              await client.listCalendars({ force: false, cacheTtlMs: this.config.cacheTtlMs })
            ).length;
          } catch {
            // status must still answer when iCloud is unreachable
          }
        }
      } catch (error) {
        const calendarError = toCalendarError(error);
        this.lastError = { code: calendarError.code, message: calendarError.message };
        configured = false;
      }
    }
    return {
      configured,
      account: description.account,
      serverUrl: this.config.serverUrl,
      secretSource: this.secretSource,
      secretEnvVar: this.config.secretEnv,
      store: {
        kind: description.store.kind,
        location: description.store.location,
        available: description.store.available,
      },
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
      proxyConfigured: this.config.proxyUrl !== '',
      writesAllowed: this.config.allowWrites,
      deletesAllowed: this.config.allowDeletes,
      connected: this.client !== undefined && this.lastError === null,
      calendarCount: this.calendarCount,
      lastError: this.lastError,
    };
  }

  /** Lists calendars, using the cache unless `force` is set. */
  async listCalendars(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<CalendarSummary[]> {
    const client = await this.connect(options.signal);
    const calendars = await client.listCalendars({
      force: options.force ?? false,
      cacheTtlMs: this.config.cacheTtlMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    this.calendarCount = calendars.length;
    return calendars;
  }

  /** Resolves requested calendar names against the account's collections. */
  async selectCalendars(requested: readonly string[] | undefined, signal?: AbortSignal): Promise<CalendarSummary[]> {
    const all = await this.listCalendars({ ...(signal === undefined ? {} : { signal }) });
    const client = await this.connect(signal);
    const names = requested !== undefined && requested.length > 0 ? requested : this.config.defaultCalendars;
    if (names.length === 0) {
      const usable = all.filter((calendar) => calendar.supportsEvents && !calendar.readOnly);
      return usable.length > 0 ? usable : all.filter((calendar) => calendar.supportsEvents);
    }
    return names.map((name) => client.resolveCalendar(all, name));
  }

  /** Reads events in a window, expanding recurring series. */
  async listEvents(options: ListEventsOptions, signal?: AbortSignal): Promise<ListEventsResult> {
    const window = resolveWindow(options.start, options.end, this.config.maxWindowDays * DAY_MS);
    const calendars = await this.selectCalendars(options.calendars, signal);
    const client = await this.connect(signal);
    return await client.listEvents(window, {
      calendars,
      ...(signal === undefined ? {} : { signal }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
  }

  /** Creates one event. Refused entirely when writes are disabled. */
  async createEvent(request: CreateEventRequest, signal?: AbortSignal): Promise<CreatedEvent> {
    if (!this.config.allowWrites) {
      throw new CalendarError(
        'CALENDAR_READ_ONLY',
        'This profile is read-only for the calendar (allowWrites is false). Set it to true to create events.',
      );
    }
    const client = await this.connect(signal);
    const all = await this.listCalendars({ ...(signal === undefined ? {} : { signal }) });
    const calendar = client.resolveCalendar(all, request.calendar);
    return await client.createEvent(calendar, request, signal);
  }

  /** Deletes events through the shared guard in `policy.ts`. */
  async deleteEvents(request: DeleteEventsRequest, signal?: AbortSignal): Promise<DeleteEventsResult> {
    return await runDelete(
      {
        config: this.config,
        selectCalendars: async (requested, inner) => await this.selectCalendars(requested, inner),
        listEvents: async (options, inner) => await this.listEvents(options, inner),
        deleteObject: async (url, etag, inner) => {
          const client = await this.connect(inner);
          await client.deleteObject(url, etag, inner);
        },
      },
      request,
      signal,
    );
  }
}

export { ConfigSchema };
export type { CalendarConfig };
export { isCalendarError };
