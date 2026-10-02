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
import type { ICloudCalendarService } from './service.js';
export declare const TOOL_NAMES: readonly ["calendar_status", "calendar_list_calendars", "calendar_list_events", "calendar_create_event", "calendar_delete_events"];
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
export declare function buildTools(): ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map