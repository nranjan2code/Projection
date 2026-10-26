import type { ResolvedNode } from "./surface.ts";

export const PLAYBACK_COMMANDS = ["play", "pause", "restart", "mute", "unmute"] as const;
export type PlaybackCommand = typeof PLAYBACK_COMMANDS[number];
export function mediaDescription(node: ResolvedNode, includeTranscript = false): string {
  const p = node.props;
  return [p.title || p.alt || `${p.kind} asset`, p.description, ...(includeTranscript ? [p.transcript] : [])].filter((v) => typeof v === "string" && v.trim()).join(". ");
}
export function playbackControls(node: ResolvedNode): { label: string; source: string; command: PlaybackCommand }[] {
  if (node.type !== "media" || !["audio", "video"].includes(String(node.props.kind))) return [];
  return PLAYBACK_COMMANDS.map((command) => ({ label: command.charAt(0).toUpperCase() + command.slice(1), source: `${node.key}#media-${command}`, command }));
}
/** Playback is local to a projector. It must never become a model/tool action. */
export function playbackKey(key: string): { node: string; command: PlaybackCommand } | undefined {
  const at = key.lastIndexOf("#media-");
  const command = key.slice(at + 7);
  return at > 0 && (PLAYBACK_COMMANDS as readonly string[]).includes(command) ? { node: key.slice(0, at), command: command as PlaybackCommand } : undefined;
}
