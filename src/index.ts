/**
 * Plugin entry point.
 *
 * OpenClaw loads this module and hands each tool the resolved plugin config, so
 * the service is built lazily from the first call's config and cached.
 */

import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { ConfigSchema, resolveConfig, type Config } from './config.js';
import { ICloudCalendarService } from './service.js';
import { buildTools } from './tools.js';

let cached: { key: string; service: ICloudCalendarService } | undefined;

/** Builds (or reuses) the service for one resolved config. */
function serviceFor(config: Config): ICloudCalendarService {
  const key = JSON.stringify(config);
  if (cached !== undefined && cached.key === key) return cached.service;
  const service = new ICloudCalendarService(resolveConfig(config));
  cached = { key, service };
  return service;
}

export default defineToolPlugin({
  id: 'icloud-calendar',
  name: 'iCloud Calendar',
  description:
    'Read and write Apple iCloud Calendar over CalDAV: list calendars, read events with recurrence expansion, create events, and confirm-gated deletes.',
  configSchema: ConfigSchema,
  tools: (tool) =>
    buildTools().map((definition) =>
      tool({
        name: definition.name,
        label: definition.name,
        description: definition.description,
        parameters: definition.parameters as never,
        execute: async (params, config, context) =>
          await definition.execute(params as Record<string, unknown>, {
            service: serviceFor(config as unknown as Config),
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          }),
      }),
    ),
});
