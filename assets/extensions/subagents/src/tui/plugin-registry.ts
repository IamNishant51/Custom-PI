import type { Component } from "@earendil-works/pi-tui";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CardRenderer<TArgs = any, TResult = any> {
  renderCall(args: TArgs, theme: any, ctx: any): Component;
  renderResult(result: TResult, options: any, theme: any, ctx: any): Component;
}

export interface PluginCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: any) => void;
  execute?: (args: string, ctx: any) => any;
}

export interface PluginEventHook {
  event: string;
  handler: (...args: any[]) => void;
}

export interface TuiPlugin {
  name: string;
  version: string;
  cardRenderers?: Record<string, CardRenderer>;
  commands?: PluginCommand[];
  eventHooks?: PluginEventHook[];
  onRegister?: () => void;
  onDeregister?: () => void;
}

// ── Registry ───────────────────────────────────────────────────────────────

const cardRegistry = new Map<string, CardRenderer>();
const commandRegistry = new Map<string, PluginCommand>();
const eventHookRegistry = new Map<string, Set<(...args: any[]) => void>>();
const pluginRegistry = new Map<string, TuiPlugin>();

export function registerPlugin(plugin: TuiPlugin): void {
  if (pluginRegistry.has(plugin.name)) {
    deregisterPlugin(plugin.name);
  }

  if (plugin.cardRenderers) {
    for (const [name, renderer] of Object.entries(plugin.cardRenderers)) {
      cardRegistry.set(name, renderer);
    }
  }

  if (plugin.commands) {
    for (const cmd of plugin.commands) {
      commandRegistry.set(cmd.name, cmd);
    }
  }

  if (plugin.eventHooks) {
    for (const hook of plugin.eventHooks) {
      if (!eventHookRegistry.has(hook.event)) {
        eventHookRegistry.set(hook.event, new Set());
      }
      eventHookRegistry.get(hook.event)!.add(hook.handler);
    }
  }

  pluginRegistry.set(plugin.name, plugin);
  plugin.onRegister?.();
}

export function deregisterPlugin(name: string): boolean {
  const plugin = pluginRegistry.get(name);
  if (!plugin) return false;

  plugin.onDeregister?.();

  if (plugin.cardRenderers) {
    for (const rendererName of Object.keys(plugin.cardRenderers)) {
      cardRegistry.delete(rendererName);
    }
  }

  if (plugin.commands) {
    for (const cmd of plugin.commands) {
      commandRegistry.delete(cmd.name);
    }
  }

  if (plugin.eventHooks) {
    for (const hook of plugin.eventHooks) {
      const handlers = eventHookRegistry.get(hook.event);
      if (handlers) {
        handlers.delete(hook.handler);
        if (handlers.size === 0) eventHookRegistry.delete(hook.event);
      }
    }
  }

  pluginRegistry.delete(name);
  return true;
}

export function getCardRenderer<TArgs = any, TResult = any>(name: string): CardRenderer<TArgs, TResult> | undefined {
  return cardRegistry.get(name) as CardRenderer<TArgs, TResult> | undefined;
}

export function getCommand(name: string): PluginCommand | undefined {
  return commandRegistry.get(name);
}

export function getEventHandlers(event: string): Set<(...args: any[]) => void> | undefined {
  return eventHookRegistry.get(event);
}

export function emitEvent(event: string, ...args: any[]): void {
  const handlers = eventHookRegistry.get(event);
  if (handlers) {
    for (const handler of handlers) {
      try { handler(...args); } catch {}
    }
  }
}

export function listPlugins(): { name: string; version: string }[] {
  return Array.from(pluginRegistry.values()).map(p => ({ name: p.name, version: p.version }));
}

export function listCardRenderers(): string[] {
  return Array.from(cardRegistry.keys());
}

export function listCommands(): string[] {
  return Array.from(commandRegistry.keys());
}
