import { playbackControls, type PlaybackCommand, type ResolvedNode } from "@vak/core";
export interface MediaResource { url: string; release?(): void }
/** The app resolves private URIs without putting its token in saved surfaces. */
export type MediaResolver = (uri: string) => Promise<MediaResource | undefined>;
export interface MediaView { el: HTMLElement; release(): void; activate(command: PlaybackCommand): boolean; pause(): void }
export function renderMedia(node: ResolvedNode, resolver?: MediaResolver): MediaView {
  const p = node.props;
  const figure = document.createElement("figure");
  figure.className = "media";
  const caption = document.createElement("figcaption");
  const label = typeof p.title === "string" ? p.title : `${p.kind} asset`;
  caption.textContent = [label, p.description].filter((v) => typeof v === "string" && v).join(" — ");
  const status = document.createElement("p"); status.className = "media-status"; status.setAttribute("role", "status");
  const image = p.kind === "image";
  const element = document.createElement(image ? "img" : p.kind === "video" ? "video" : "audio");
  element.setAttribute("aria-label", label);
  if (element instanceof HTMLImageElement) { element.alt = String(p.alt ?? label); element.loading = "lazy"; }
  const player = element instanceof HTMLMediaElement ? element : undefined;
  if (player) { player.controls = true; player.preload = "metadata"; if (player instanceof HTMLVideoElement) player.playsInline = true; }
  let dead = false;
  let resource: MediaResource | undefined;
  const state = () => figure.dispatchEvent(new CustomEvent("vak-media-state", { bubbles: true, composed: true, detail: { key: node.key, playing: Boolean(player && !player.paused && !player.muted), player } }));
  for (const event of ["play", "pause", "ended", "volumechange"]) player?.addEventListener(event, state);
  const activate = (command: PlaybackCommand): boolean => {
    if (!player || dead || !player.src) return false;
    if (command === "play" || command === "restart") {
      if (command === "restart") player.currentTime = 0;
      void player.play().catch(() => { status.textContent = "Playback needs a click, or this file cannot be played."; });
    } else if (command === "pause") player.pause();
    else player.muted = command === "mute";
    return true;
  };
  figure.append(caption, element);
  if (player) {
    const buttons = document.createElement("div"); buttons.className = "media-controls";
    for (const control of playbackControls(node)) { const button = document.createElement("button"); button.type = "button"; button.className = "btn secondary"; button.textContent = control.label; button.addEventListener("click", () => activate(control.command)); buttons.append(button); }
    figure.append(buttons);
  }
  if (typeof p.transcript === "string" && p.transcript) { const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Transcript"; const transcript = document.createElement("p"); transcript.textContent = p.transcript; details.append(summary, transcript); figure.append(details); }
  figure.append(status);
  void (async () => {
    try {
      const src = String(p.src ?? "");
      resource = await resolver?.(src);
      const url = resource?.url ?? src;
      if (dead) return resource?.release?.();
      if (!/^(https:\/\/|blob:)/.test(url) && !(image && /^data:image\/(png|jpeg|webp);base64,/.test(url))) throw new Error("Unavailable media source");
      element.src = url;
    } catch { if (!dead) status.textContent = "This media file is unavailable. Open it in its source app or choose another file."; }
  })();
  return { el: figure, activate, pause() { player?.pause(); }, release() { if (dead) return; player?.pause(); state(); dead = true; resource?.release?.(); element.removeAttribute("src"); } };
}
